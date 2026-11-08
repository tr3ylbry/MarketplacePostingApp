import { z } from "zod";
import type { EbayConfig } from "./config";
import { EBAY_SCOPES } from "../../application/ebayConnection";
import {
  ebayCategoryId, EbayMetadataError, usedConditionEnums,
  type EbayCategory, type EbayCategoryBranch, type EbayCategoryRequirements, type EbayMetadataGateway,
} from "../../application/ebayMetadata";

const text = z.string().trim().min(1).max(200).refine(s => !/[<>]/.test(s) && ![...s].some(c => c.charCodeAt(0) < 32));
const aspectName = text.refine(s => !["__proto__", "constructor", "prototype"].includes(s));
const treeId = z.string().regex(/^[0-9]{1,20}$/);
const tree = z.object({ categoryTreeId: treeId, categoryTreeVersion: text });
const node = z.object({
  category: z.object({ categoryId: ebayCategoryId, categoryName: text }),
  leafCategoryTreeNode: z.boolean().optional().default(false),
  // Descendants are bounded by the response cap; only immediate children leave this adapter.
  childCategoryTreeNodes: z.array(z.unknown()).max(2000).optional(),
}).refine(n => !n.leafCategoryTreeNode || !n.childCategoryTreeNodes?.length);
const children = z.array(node).max(2000)
  .refine(nodes => new Set(nodes.map(n => n.category.categoryId)).size === nodes.length);
const parentNode = z.object({
  category: z.object({ categoryId: ebayCategoryId, categoryName: text }),
  leafCategoryTreeNode: z.boolean().optional().default(false),
  childCategoryTreeNodes: children.optional(),
}).refine(n => !n.leafCategoryTreeNode || !n.childCategoryTreeNodes?.length);
const root = tree.extend({ rootCategoryNode: z.object({ childCategoryTreeNodes: children.refine(nodes => nodes.length > 0) }) });
const subtree = tree.extend({ categorySubtreeNode: parentNode });
const aspectResponse = z.object({ aspects: z.array(z.object({
  localizedAspectName: aspectName,
  aspectConstraint: z.object({
    aspectRequired: z.boolean(), aspectMode: z.enum(["FREE_TEXT", "SELECTION_ONLY"]),
    itemToAspectCardinality: z.enum(["SINGLE", "MULTI"]), aspectDataType: z.enum(["STRING", "NUMBER", "DATE"]),
    aspectMaxLength: z.number().int().positive().max(10000).optional(),
    aspectFormat: text.optional(), aspectAdvancedDataType: text.optional(),
  }),
  aspectValues: z.array(z.object({
    localizedValue: text,
    valueConstraints: z.array(z.object({
      applicableForLocalizedAspectName: aspectName,
      applicableForLocalizedAspectValues: z.array(text).min(1).max(1000),
    })).max(50).optional(),
  })).max(10000).refine(values => new Set(values.map(v => v.localizedValue)).size === values.length).optional(),
})).max(300) });
const conditionResponse = z.object({ itemConditionPolicies: z.array(z.object({
  categoryId: ebayCategoryId, categoryTreeId: treeId, itemConditionRequired: z.boolean(),
  itemConditions: z.array(z.object({
    conditionId: z.string().regex(/^[0-9]{1,5}$/), conditionDescription: text,
    usage: text.optional(), conditionDescriptors: z.array(z.unknown()).max(100).optional(),
  })).min(1).max(100).refine(conditions => new Set(conditions.map(c => c.conditionId)).size === conditions.length),
})).length(1) });
const applicationToken = z.object({
  access_token: z.string().min(1).max(16000).refine(s => !/[\r\n\0]/.test(s)),
  expires_in: z.number().int().min(61).max(86400),
  token_type: z.enum(["Application Access Token", "Bearer", "bearer"]), scope: z.string().max(4000).optional(),
});
const category = (value: z.infer<typeof node>): EbayCategory => ({
  id: value.category.categoryId, name: value.category.categoryName, leaf: value.leafCategoryTreeNode,
});

export class EbayMetadataClient implements EbayMetadataGateway {
  private cached?: { token: string; expires: number };
  private pending?: Promise<string>;
  constructor(private readonly config: EbayConfig, private readonly transport: typeof fetch = fetch, private readonly clock = Date.now) {}

  private async json(url: URL, init: RequestInit, limit: number): Promise<unknown> {
    try {
      const response = await this.transport(url.toString(), {
        ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !/^application\/json\b/i.test(response.headers.get("content-type") ?? "")) {
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 401) this.cached = undefined;
        if (response.status === 429) throw new EbayMetadataError("rate-limit");
        throw new EbayMetadataError("unavailable");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new EbayMetadataError("unavailable");
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > limit) throw new EbayMetadataError("unavailable");
          chunks.push(next.value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error instanceof EbayMetadataError) throw error;
      throw new EbayMetadataError("unavailable");
    }
  }

  private token(): Promise<string> {
    if (this.cached && this.cached.expires > this.clock() + 60000) return Promise.resolve(this.cached.token);
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const issued = this.clock();
      const body = new URLSearchParams({ grant_type: "client_credentials", scope: EBAY_SCOPES[0] });
      const raw = await this.json(new URL("https://api.sandbox.ebay.com/identity/v1/oauth2/token"), {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(this.config.clientId + ":" + this.config.clientSecret).toString("base64") }, body: body.toString(),
      }, 65536);
      const token = applicationToken.parse(raw);
      if (token.scope !== undefined && (token.scope.trim() !== EBAY_SCOPES[0])) throw new EbayMetadataError("unavailable");
      this.cached = { token: token.access_token, expires: issued + token.expires_in * 1000 };
      return token.access_token;
    })().catch(error => {
      if (error instanceof EbayMetadataError) throw error;
      throw new EbayMetadataError("unavailable");
    }).finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async get(path: string, query: Record<string, string> = {}): Promise<unknown> {
    // Call sites below supply only fixed API paths and validated numeric IDs.
    const url = new URL("https://api.sandbox.ebay.com" + path);
    url.search = new URLSearchParams(query).toString();
    return this.json(url, { method: "GET", headers: { Authorization: "Bearer " + await this.token(), Accept: "application/json", "Accept-Language": "en-US" } }, 8 * 1024 * 1024);
  }

  async browse(id?: string): Promise<EbayCategoryBranch> {
    if (id !== undefined && !ebayCategoryId.safeParse(id).success) throw new EbayMetadataError("category");
    try {
      const current = tree.parse(await this.get("/commerce/taxonomy/v1/get_default_category_tree_id", { marketplace_id: "EBAY_US" }));
      const path = "/commerce/taxonomy/v1/category_tree/" + current.categoryTreeId;
      if (id === undefined) {
        const result = root.parse(await this.get(path));
        if (result.categoryTreeId !== current.categoryTreeId || result.categoryTreeVersion !== current.categoryTreeVersion) throw new Error();
        return { treeId: result.categoryTreeId, treeVersion: result.categoryTreeVersion, category: null, children: result.rootCategoryNode.childCategoryTreeNodes.map(category) };
      }
      const result = subtree.parse(await this.get(path + "/get_category_subtree", { category_id: id }));
      if (result.categoryTreeId !== current.categoryTreeId || result.categoryTreeVersion !== current.categoryTreeVersion || result.categorySubtreeNode.category.categoryId !== id) throw new Error();
      return { treeId: result.categoryTreeId, treeVersion: result.categoryTreeVersion, category: category(result.categorySubtreeNode), children: (result.categorySubtreeNode.childCategoryTreeNodes ?? []).map(category) };
    } catch (error) {
      if (error instanceof EbayMetadataError) throw error;
      throw new EbayMetadataError("unavailable");
    }
  }

  async requirements(id: string): Promise<EbayCategoryRequirements> {
    const branch = await this.browse(id);
    if (!branch.category?.leaf) throw new EbayMetadataError("category");
    try {
      const aspects = aspectResponse.parse(await this.get("/commerce/taxonomy/v1/category_tree/" + branch.treeId + "/get_item_aspects_for_category", { category_id: id }));
      const response = conditionResponse.parse(await this.get("/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies", { filter: "categoryIds:{" + id + "}" }));
      const policy = response.itemConditionPolicies[0];
      if (policy.categoryId !== id || policy.categoryTreeId !== branch.treeId || new Set(aspects.aspects.map(a => a.localizedAspectName)).size !== aspects.aspects.length) throw new Error();
      return { branch, aspects: aspects.aspects.map(a => ({
        name: a.localizedAspectName, required: a.aspectConstraint.aspectRequired, mode: a.aspectConstraint.aspectMode,
        cardinality: a.aspectConstraint.itemToAspectCardinality, dataType: a.aspectConstraint.aspectDataType,
        format: a.aspectConstraint.aspectFormat, advancedType: a.aspectConstraint.aspectAdvancedDataType,
        maxLength: Math.min(a.aspectConstraint.aspectMaxLength ?? 65, 200),
        values: (a.aspectValues ?? []).map(v => ({ value: v.localizedValue, conditional: !!v.valueConstraints?.length })),
      })), conditions: policy.itemConditions.map(c => ({
        id: c.conditionId, name: c.conditionDescription,
        supported: Object.prototype.hasOwnProperty.call(usedConditionEnums, c.conditionId) && (!c.usage || c.usage === "ALL") && !c.conditionDescriptors?.length,
      })) };
    } catch (error) {
      if (error instanceof EbayMetadataError) throw error;
      throw new EbayMetadataError("unavailable");
    }
  }
}
