/* Pull the JSON-LD blocks out of an HTML page.

   Most recipe sites publish the whole recipe as schema.org JSON-LD inside
   <script type="application/ld+json">, for search engines. Reading that is far more
   reliable than guessing at each site's markup.

   Shared between the browser (when you paste a page's source) and the Edge Function
   (when it fetches a URL for you), which is why it lives in _shared and why it uses no
   DOM, no Deno API and no imports.

   Written as a linear scan rather than a regex over the whole document. The input is
   untrusted HTML from the open internet, and a regex with nested quantifiers over a
   hostile megabyte is how you get a denial of service. This only ever moves forwards. */

export function extractLdJsonBlocks(html: string, maxBlocks = 10, maxBlockLength = 200_000): string[] {
  const lower = html.toLowerCase();
  const blocks: string[] = [];
  let from = 0;

  while (blocks.length < maxBlocks) {
    const open = lower.indexOf("<script", from);
    if (open === -1) break;

    const tagEnd = lower.indexOf(">", open);
    if (tagEnd === -1) break;

    const close = lower.indexOf("</script", tagEnd);
    if (close === -1) break;

    from = close + 8;

    const attributes = lower.slice(open, tagEnd);
    if (!attributes.includes("application/ld+json")) continue;

    const body = html.slice(tagEnd + 1, close).trim();
    // An oversized block is dropped, not truncated: half a JSON document is not valid.
    if (body.length > 0 && body.length <= maxBlockLength) blocks.push(body);
  }

  return blocks;
}
