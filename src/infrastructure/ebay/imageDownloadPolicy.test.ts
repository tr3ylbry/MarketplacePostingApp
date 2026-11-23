// @vitest-environment node
import { assertOfflineGuards } from "../../test/offlinePrototypeGuards";
import { imageRequestTarget,imageResponseHeaders } from "./imageDownloadPolicy";
import { inspectModeledImageUrl } from "../../application/offlineImageUrlPolicy";
it("blocks outside I/O",assertOfflineGuards);
it.each(["/a.png?x=A%2fb+Q&x=&x=2","/a%41.jpg?opaque=%3f%26%40","/a.png?","/a.png"])("preserves accepted synthetic targets %#",target=>{
  const raw="https://i.sandbox.ebayimg.com"+target;expect(imageRequestTarget(raw)).toBe(target);expect(inspectModeledImageUrl(raw).accepted).toBe(true);
});
it.each(["https://i.sandbox.ebayimg.com:443/a","https://I.sandbox.ebayimg.com/a","https://i.sandbox.ebayimg.com./a","https://@i.sandbox.ebayimg.com/a","https://i.sandbox.ebayimg.com/a#","https://i.sandbox.ebayimg.com//a","https://i.sandbox.ebayimg.com/./a","https://i.sandbox.ebayimg.com/a%2fb","https://i.sandbox.ebayimg.com/a?x=%25ff","https://i.sandbox.ebayimg.com/a?x=%0d","https://i.sandbox.ebayimg.com/a?x=%GG","https://i.sandbox.ebayimg.com/a\\b", "x".repeat(8193)])("refuses conservative raw-policy case %#",raw=>{expect(()=>imageRequestTarget(raw)).toThrow();expect(inspectModeledImageUrl(raw).accepted).toBe(false);});
it.each(["image/png","image/jpeg"])("accepts unencoded bounded %s headers",mime=>{expect(imageResponseHeaders(Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: ${mime}\r\nContent-Length: 4\r\n\r\n`))).toEqual({length:4,mime,chunked:false});});
it.each(["Content-Type: image/png\r\ncontent-type: image/png", "Content-Type: image/png\r\nX: a\r\n b", "Content-Type: image/png\r\nContent-Length: 01", "Content-Type: image/png\r\nContent-Length: 1048577", "Content-Type: image/png\r\nTrailer: foo", "Content-Type: image/png\r\nContent-Encoding: br", "Content-Type: image/png\r\nConnection: keep-alive", "Content-Type: image/png\r\nX: \tbad"])("refuses ambiguous headers %#",h=>{expect(()=>imageResponseHeaders(Buffer.from(`HTTP/1.1 200 OK\r\n${h}\r\n\r\n`))).toThrow();});
