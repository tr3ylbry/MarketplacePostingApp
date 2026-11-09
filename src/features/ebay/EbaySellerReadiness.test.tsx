import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EbaySellerReadiness } from "./EbaySellerReadiness";
import type { EbayReadinessReport } from "../../application/ebayReadinessService";

const { check } = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock("../../app/listings/[id]/ebay/actions", () => ({ checkEbayReadinessAction: check }));
const report = (): EbayReadinessReport => ({
  environment: "sandbox", marketplace: "EBAY_US", checkedAt: "2026-11-09T00:00:00.000Z",
  registrationComplete: false, zeroMonthlyQuantityLimit: true, businessPoliciesEnrolled: false,
  policies: { fulfillment: [], payment: [], return: [] }, locations: [],
  inventoryEligibility: "unverified", categoryCompatibility: "not-verified", canStage: false, canCreateOffer: false, canPublish: false,
});
beforeEach(() => { check.mockReset(); });
it.each([{ connected: false, authorized: false }, { connected: true, authorized: false }])("makes no passive requests and requires a verified, authorized connection: %o", props => {
  render(<EbaySellerReadiness listingId="fixture" version="version" {...props} />);
  expect(check).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Check eBay Seller Readiness" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "eBay connection and permissions" })).toHaveAttribute("href", "/settings/integrations/ebay#readiness-permissions");
});
it("loads only on request, explains absent prerequisites, and never offers remote writes", async () => {
  check.mockResolvedValueOnce({ ok: true, data: report() });
  render(<EbaySellerReadiness listingId="fixture" version="version" connected authorized />);
  expect(check).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check eBay Seller Readiness" }));
  expect(await screen.findByRole("region", { name: "Seller readiness result" })).toBeVisible();
  expect(check).toHaveBeenCalledWith("fixture", "version");
  expect(screen.getByText(/finish seller registration/)).toBeVisible();
  expect(screen.getByText(/Not enrolled — manage business policies/)).toBeVisible();
  expect(screen.getByText(/No usable enabled warehouse/)).toBeVisible();
  expect(screen.getByText(/write eligibility remains unverified/)).toBeVisible();
  expect(screen.getByText(/sparse unpublished offer does not necessarily require/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /create|stage|publish|upload/i })).not.toBeInTheDocument();
});
it("allows only existing compatible candidates and keeps unsuitable locations disabled", async () => {
  const result = report();
  result.policies.fulfillment = [
    { id: "100", name: "Synthetic standard shipping", categoryTypes: ["ALL_EXCLUDING_MOTORS_VEHICLES"] },
    { id: "101", name: "Synthetic motor shipping", categoryTypes: ["MOTORS_VEHICLES"] },
  ];
  result.locations = [
    { key: "enabled", name: null, enabled: true, warehouse: true, addressComplete: true },
    { key: "disabled", name: null, enabled: false, warehouse: true, addressComplete: true },
    { key: "store", name: null, enabled: true, warehouse: false, addressComplete: true },
    { key: "incomplete", name: null, enabled: true, warehouse: true, addressComplete: false },
  ];
  check.mockResolvedValueOnce({ ok: true, data: result });
  render(<EbaySellerReadiness listingId="fixture" version="version" connected authorized />);
  fireEvent.click(screen.getByRole("button", { name: "Check eBay Seller Readiness" }));
  const policy = await screen.findByLabelText("Fulfillment policy");
  fireEvent.change(policy, { target: { value: "100" } }); expect(policy).toHaveValue("100");
  expect(screen.queryByRole("option", { name: /Synthetic motor/ })).not.toBeInTheDocument();
  for (const key of ["disabled", "store", "incomplete"]) expect(screen.getByRole("option", { name: new RegExp("\\(" + key + "\\)") })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Inventory warehouse location"), { target: { value: "enabled" } });
  expect(check).toHaveBeenCalledTimes(1);
});
it("clears an earlier report when a later explicit check fails", async () => {
  check.mockResolvedValueOnce({ ok: true, data: report() }).mockResolvedValueOnce({ ok: false, error: "Seller connection changed. Check again." });
  render(<EbaySellerReadiness listingId="fixture" version="version" connected authorized />);
  const button = screen.getByRole("button", { name: "Check eBay Seller Readiness" });
  fireEvent.click(button); await screen.findByRole("region", { name: "Seller readiness result" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("Seller connection changed");
  expect(screen.queryByRole("region", { name: "Seller readiness result" })).not.toBeInTheDocument();
});
