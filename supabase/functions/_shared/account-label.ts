// Kryzer is an agency: every client's UpSeller catalog feeds into ONE
// central Canva account that the agency itself edits. So there is only
// ever a single Canva OAuth token — not one per client — even though
// product_links.cliente varies per real client (POLLIANA, etc.) for
// labeling/title purposes (SKU_KRYZER_NOMECLIENTE).
export const CANVA_ACCOUNT_LABEL = "kryzer_polliana";
