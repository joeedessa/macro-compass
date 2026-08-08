"use strict";
/* Interpretation notes shown when a card is flipped.
   These describe how each signal is conventionally read in macro research —
   central bank, multilateral and sell-side work all lean on the same handful of
   framings. They are standard interpretations, not quotations, and every one of
   them fails sometimes; the notes say so where the failure mode is well known. */

window.INFO = {
  // ---- regime ------------------------------------------------------------
  regime: {
    title: "How the regime score is built",
    body: [
      "Seven conditions, each either met or not, spanning trend, volatility, credit, sector leadership, the industrial cycle and the yield curve. The count is deliberately not weighted into a single index: aggregation hides which component is dissenting, and the dissent is usually the information.",
      "Composite financial-conditions indices published by central banks and multilateral bodies follow the same logic — combining price, volatility, credit spreads and term structure — because no single market segment reliably identifies a turn on its own.",
      "The standard caution: these are coincident-to-lagging measures. A trend filter confirms a regime that is already underway and will not call the turn. Credit and breadth tend to deteriorate first, which is why they are shown separately rather than blended in.",
    ],
  },
  breadth: {
    title: "Why breadth matters",
    body: [
      "The share of markets trading above their own 200-day average measures participation. A rising index carried by a narrowing set of names is treated as more fragile than the same index level supported by broad participation.",
      "Concentration has been a recurring theme in financial stability commentary: when index gains depend on a handful of large constituents, an idiosyncratic shock to those names transmits to the whole index and to the passive flows tracking it.",
    ],
  },

  // ---- relative strength -------------------------------------------------
  "QQQ/SPY": {
    title: "Growth versus the broad market",
    body: [
      "Long-duration growth equities are the most sensitive part of the equity market to discount rates, because more of their value sits in distant cash flows. This ratio therefore tends to track real yields inversely — growth leads when real rates fall.",
      "Read alongside the 10-year: growth outperforming while real yields rise is unusual and usually means the move is being driven by earnings revisions rather than by rates.",
    ],
  },
  "IWM/SPY": {
    title: "Small versus large capitalisation",
    body: [
      "Small caps are more domestically exposed, more credit-dependent and carry higher operating leverage. Their relative performance is conventionally read as a proxy for domestic growth expectations and the ease of financial conditions.",
      "Because small caps refinance at floating and shorter-dated rates, this ratio is sensitive to bank lending standards. Research on the bank lending channel treats small-firm equity performance as an observable expression of credit availability.",
    ],
  },
  "QQQ/IWM": {
    title: "Mega-cap tech versus small caps",
    body: [
      "The report tracks this pair directly. It combines the duration signal in growth with the credit signal in small caps, so it moves further and faster than either leg alone.",
      "A persistent uptrend describes a market where leadership is narrow and rate-sensitive; a sustained downtrend usually accompanies broadening participation and improving domestic credit.",
    ],
  },
  "MAGS/SPY": {
    title: "Mega-cap concentration",
    body: [
      "Measures whether the largest technology constituents are driving the index or lagging it. Elevated and rising concentration is a recurring financial-stability concern: index-level risk becomes dependent on a small number of correlated names.",
      "Treat this as a fragility gauge rather than a directional signal. Concentration can rise for a long time in a healthy market; it matters most when it is rising while breadth deteriorates.",
    ],
  },
  "SPY/RSP": {
    title: "Cap-weighted versus equal-weighted",
    body: [
      "The cleanest available concentration measure: the same index, weighted two ways. A rising line means the largest names are outperforming the average name, so the headline index is flattering the typical constituent.",
      "Widely used to sanity-check index performance. When this ratio rises while the index makes new highs, the new highs are being manufactured by a shrinking group — the classic narrow-leadership configuration.",
    ],
  },
  "EEM/SPY": {
    title: "Emerging markets versus the US",
    body: [
      "Emerging market equity performance is conventionally tied to the dollar cycle, global trade volumes and commodity demand. Sustained EM outperformance has historically required a stable-to-weaker dollar.",
      "The dollar channel is the mechanism most emphasised in international research: a stronger dollar tightens financial conditions for borrowers with dollar liabilities and is associated with reduced global risk appetite and cross-border lending.",
    ],
  },
  "EFA/SPY": {
    title: "Developed ex-US versus the US",
    body: [
      "Largely a currency, sector-composition and valuation story. Ex-US developed indices carry more financials, industrials and resources, and less large-cap technology, so this ratio often moves with the value-versus-growth rotation.",
      "Unhedged, a meaningful part of the move is simply the dollar. Check it against the dollar index before reading it as an equity-fundamentals signal.",
    ],
  },
  "XLY/XLP": {
    title: "Cyclical versus defensive",
    body: [
      "A within-equity risk appetite gauge. Because both legs are equities, it strips out the market direction and isolates whether investors are positioning for expansion or protection.",
      "Its main use is as a cross-check: an index rising while defensives lead is a lower-quality advance than the same move led by cyclicals. Divergence between the two is a standard early warning that participation is deteriorating.",
    ],
  },
  "HYG/IEF": {
    title: "Credit risk appetite",
    body: [
      "High yield credit against duration-matched Treasuries isolates compensation for default risk. Credit markets are widely held to lead equities at turning points, since refinancing conditions bind before earnings do.",
      "Spread widening is a core input to nearly every published financial-conditions index. The configuration that gets attention is credit deteriorating while equities hold up — historically a more reliable warning than either market alone.",
    ],
  },
  "HG=F/GC=F": {
    title: "Copper versus gold",
    body: [
      "Copper is levered to industrial and construction demand; gold is a monetary and haven asset. The ratio is a long-standing proxy for growth expectations relative to fear.",
      "Its best-known use is as a cross-check on the 10-year yield: the two normally travel together, and a persistent gap is read as one of the two markets mispricing the growth outlook. Copper carries genuine supply-side noise — mine disruptions and inventory shifts — so confirm before treating it as a pure demand signal.",
    ],
  },
  "SMH/SPY": {
    title: "Semiconductors versus the market",
    body: [
      "Semiconductors sit early in the global manufacturing chain, so orders and pricing turn ahead of broader industrial activity. Semiconductor billings have long been used as a leading indicator of the global trade and capex cycle.",
      "The caveat now matters more than it used to: a large share of the sector's performance is driven by a single end-market in AI infrastructure, which weakens the read-across to the broad manufacturing cycle.",
    ],
  },
  "SPY/GLD": {
    title: "Equities versus gold",
    body: [
      "Compares a claim on future earnings with a non-yielding real asset. Falls when investors prefer a store of value — typically alongside negative real rates, inflation concern, or geopolitical and monetary-credibility stress.",
      "Central bank reserve accumulation has become a material part of gold demand, which can hold the gold leg firm for reasons unrelated to the investor risk appetite this ratio is usually read for.",
    ],
  },
  "GVAL/SPY": {
    title: "Global deep value versus the US",
    body: [
      "GVAL holds equities from the cheapest countries in the world on long-run valuation measures such as the cyclically adjusted P/E, so this ratio pits the most out-of-favour markets against the most expensive large market. It is a country-level value trade in one line.",
      "Valuation spreads between countries have historically mean-reverted, but over horizons measured in years, and the spread can widen for a long time first. Read it as a positioning and regime gauge, not a timing signal.",
      "A sustained turn higher usually travels with a weaker dollar and broadening global participation — EFA/SPY, EEM/SPY and the dollar index should confirm the same rotation if it is real.",
    ],
  },
  "GDX/GLD": {
    title: "Gold miners versus gold",
    body: [
      "Miners are an operationally levered claim on the gold price: costs are fixed in the short run, so margins move faster than the metal. Miners leading the metal is read as conviction in the move; miners lagging a rising gold price is a persistent late-cycle warning that equity investors do not believe the price.",
      "The leverage cuts both ways and the relationship drifts with energy costs and equity beta, so the signal is in sustained divergence, not day-to-day wiggle.",
    ],
  },
  "GDXJ/GDX": {
    title: "Junior versus senior miners",
    body: [
      "Juniors are smaller, less capitalised and more speculative, so this is a risk-appetite read inside the mining complex itself. Juniors leading is the aggressive phase of a metals bull market; juniors being derisked while seniors hold up often precedes broader weakness in the trade.",
    ],
  },
  "COPX/HG=F": {
    title: "Copper miners versus copper",
    body: [
      "The equity market's forward judgement on the copper price: miners discount future prices and costs, while the futures leg is closer to spot. Miners leading is read as equity investors positioning for the move to extend.",
      "Composition matters — COPX carries country and company risk (a large share of listed copper production sits in a handful of jurisdictions), so divergence can reflect mining-specific trouble rather than a copper view.",
    ],
  },

  // ---- markets -----------------------------------------------------------
  movingAverages: {
    title: "Reading the moving averages",
    body: [
      "The 200-day average is the conventional long-term trend filter and is the one the source report uses to decide whether to look for long setups at all. Price above it is treated as an uptrend regime, below it as a downtrend regime.",
      "The 50-day tracks the intermediate swing and the 150-day sits between the two; crossings of the 50 through the 200 (the 'golden' and 'death' cross) are among the most widely watched signals in trend-following, though their standalone predictive record is modest and they signal late by construction.",
      "The 21-day exponential average approximates one trading month and weights recent prices more heavily, so it is used for short-term momentum and as a dynamic support level in strong trends.",
      "All moving averages are lagging by construction. They describe the regime you are in; they do not anticipate the next one.",
    ],
  },
  mag7: {
    title: "The Magnificent Seven",
    body: [
      "The seven largest US technology-related constituents, which together account for a large share of index capitalisation and have driven a disproportionate share of index returns in recent years.",
      "For a macro reader the interest is concentration rather than stock selection: when index performance depends on a small, highly correlated group, index-level risk is less diversified than it appears, and passive flows amplify the linkage. Compare against the SPY/RSP ratio above.",
    ],
  },

  family: {
    title: "The Economic Modern Family",
    body: [
      "A framework published by Mish Schneider, Chief Strategist at MarketGauge, which reads the economy through six sector ETFs rather than the headline index. Each member stands for a different part of the real economy: small caps for domestic business, retail for the consumer, regional banks for credit creation, transportation for goods actually moving, biotech for speculative appetite and semiconductors for the capex cycle. Bitcoin was added later as a liquidity and risk-appetite read.",
      "The question it asks is whether the family is moving together or splitting. When every member is trending, the expansion is broad and being aggressive is better supported. When members diverge — typically banks or transportation dropping away while semiconductors carry the index — the framework treats that as a signal to reduce risk, because the index is being held up by a narrowing part of the economy.",
      "Its appeal for a macro reader is that each member is economically interpretable rather than a statistical factor. Transportation weakening is a claim about freight; regional banks weakening is a claim about credit. That makes divergences diagnosable instead of merely observed.",
      "Two honest caveats. Sector ETFs carry idiosyncratic composition risk — semiconductor performance is currently dominated by a handful of AI-linked names, so it reads less cleanly as a broad cycle signal than it once did. And like every trend-following measure here, the 200-day filter confirms a regime rather than anticipating it.",
      "This is an independent implementation from the framework's public description; it is not affiliated with or endorsed by MarketGauge, and the nicknames are theirs.",
    ],
  },

  // ---- official flows ----------------------------------------------------
  cb_foreign_custody: {
    title: "Foreign official Treasuries held at the Fed",
    body: [
      "Marketable Treasuries the New York Fed holds in custody for foreign central banks and international institutions. Published weekly, which makes it the most timely public read on official foreign demand — TIC data on the same question arrives with roughly a two-month lag.",
      "Read the trend, not the level. Sustained declines are watched as evidence of reserve diversification or of central banks selling dollars to defend their currencies; the two have very different implications and this series cannot distinguish them.",
      "A major caveat: custody is not ownership of the whole stock. Reserve managers increasingly hold Treasuries through commercial custodians in London, Belgium and elsewhere, so holdings can shift between custodians without any change in underlying demand.",
    ],
  },
  cb_fed_treasuries: {
    title: "Fed Treasury holdings",
    body: [
      "The Treasury portfolio on the Federal Reserve's own balance sheet — the direct measure of quantitative easing and tightening. A falling line means the Fed is letting securities run off, so the private market must absorb more issuance.",
      "This matters for term premium: when the largest price-insensitive buyer steps back, duration has to be taken down by investors who demand compensation for it. Balance sheet runoff is generally treated as a slow, background tightening rather than an event.",
    ],
  },
  cb_foreign_held: {
    title: "Federal debt held by foreign investors",
    body: [
      "The total stock of US federal debt held outside the country, official and private combined. Quarterly and slow-moving, so it is context rather than signal.",
      "The share matters more than the level: foreign investors have funded a declining proportion of a rapidly growing debt stock, which shifts the marginal buyer toward domestic and price-sensitive investors, and is one structural argument for higher term premium.",
    ],
  },
  auc_ind_10y: {
    title: "Indirect bidders at auction",
    body: [
      "The share of an auction taken by indirect bidders — bids placed through a primary dealer on behalf of someone else. This category is dominated by foreign central banks and other official accounts, so it is the standard real-time proxy for official demand.",
      "It is a proxy and not a clean one: indirect also captures domestic asset managers bidding through dealers, and the classification depends on how a bid was routed rather than who ultimately owns the bond. Read a run of auctions, not one.",
      "A weak auction shows up as low indirect participation with dealers left holding an outsized share, which they then typically hedge — one reason a poor auction can move the whole curve.",
    ],
  },
  auc_btc_10y: {
    title: "Bid-to-cover ratio",
    body: [
      "Total bids divided by the amount sold. The headline gauge of auction demand: higher means the sale was covered comfortably, lower means it struggled to clear.",
      "Judge it against the recent average for the same tenor rather than in absolute terms, since each maturity has its own normal range. The other things to watch alongside it are the tail — the gap between the auction yield and the market yield beforehand — and the dealer share.",
      "Auction quality has become a live macro variable as issuance has grown: a series of poor long-end auctions is read as the market demanding more term premium to absorb supply.",
    ],
  },
  res_cn_gold: {
    title: "Gold in official reserves",
    body: [
      "The dollar value of gold held in a country's official reserves, derived here as World Bank total reserves minus reserves excluding gold. For China this is the closest free official series to 'central bank gold buying', and its trajectory — roughly doubling in dollar terms in a single recent year — is why official gold demand has become a macro theme.",
      "The essential caveat: this is a value measure, so it conflates two things. It rises when the central bank buys gold and it rises when the gold price goes up. A year of no purchases in a gold bull market still shows a sharply rising line. Tonnage is the clean quantity measure, and no free API publishes it — the World Gold Council and IMF IFS carry it under licence.",
      "China-specific: the PBoC reports its gold holdings monthly to the IMF, but is widely assessed — including in mainstream sell-side and academic work — to under-report, with actual holdings accumulated through non-reported channels. Announced pauses in buying have historically not always matched trade-flow evidence. Treat the official figure as a floor.",
      "Why it matters for markets: sustained official buying is price-insensitive demand that does not respond to yield or momentum, which changes gold's behaviour as a portfolio asset — one reason gold has been able to rise alongside positive real rates, breaking its textbook relationship.",
    ],
  },
  res_china: {
    title: "Official FX reserves",
    body: [
      "Foreign exchange reserves excluding gold, as reported to the IMF. For China and Japan these are among the largest official pools of capital in the world, so their direction affects global demand for reserve assets.",
      "Two mechanical caveats before reading a move as a policy decision. Reserves are reported in dollars, so a stronger dollar mechanically shrinks the reported value of euro and yen holdings without anything being bought or sold. And valuation changes on the bond portfolio move the total as yields move.",
      "The currency composition of any individual country's reserves is not published — China in particular does not disclose it. The IMF's COFER data gives currency shares only for the world in aggregate. Anyone claiming to know one country's precise breakdown is estimating.",
      "Gold is excluded here by construction. Official gold buying has been a significant part of reserve accumulation in recent years, so a flat FX reserve line can coexist with rising total reserves.",
    ],
  },

  // ---- macro fundamentals ------------------------------------------------
  us_cpi_yoy: {
    title: "US CPI inflation",
    body: [
      "Headline consumer price inflation, year over year. The Federal Reserve's formal 2% target is defined on the PCE price index rather than CPI, so CPI typically runs slightly higher; the gap comes from differences in weights and scope.",
      "Markets trade CPI because it is released first and drives inflation-linked products. For policy read-through, the composition matters more than the headline: shelter and services are the persistent components, energy the volatile one.",
    ],
  },
  us_unemployment: {
    title: "US unemployment rate",
    body: [
      "One half of the Federal Reserve's dual mandate. Assessed against estimates of its longer-run sustainable level rather than in absolute terms.",
      "The Sahm rule is the best-known real-time framing: a rise of roughly half a percentage point in the three-month average above its prior twelve-month low has historically coincided with the onset of recession. It is an empirical regularity, and its originator has publicly cautioned against treating it as a mechanical trigger.",
    ],
  },
  us_gdp_growth: {
    title: "US real GDP growth",
    body: [
      "Quarterly output growth at an annualised rate. Published in successive estimates that are revised as source data arrive, so early prints carry real uncertainty.",
      "Compared against estimates of potential growth to judge whether the economy is opening or closing an output gap — the framework underpinning most published forecasts and policy rules.",
    ],
  },
  us_payrolls_chg: {
    title: "Nonfarm payrolls",
    body: [
      "The monthly change in employment, and the single most market-moving US data release. Judged against the pace needed to absorb labour force growth, which shifts with demographics and migration.",
      "Subject to substantial revision and to annual benchmarking against tax records, so single months are weak evidence. Three-month averages are the standard way to read the trend.",
    ],
  },
  us_fed_funds: {
    title: "Fed funds target",
    body: [
      "The policy rate. Its transmission runs through the whole curve, so the level matters less than its position relative to estimates of the neutral rate and relative to what forward markets already price.",
      "For positioning, the gap between the policy path priced by markets and the path implied by policymakers' own projections is usually more informative than the current level.",
    ],
  },
  ea_hicp_yoy: {
    title: "Euro area HICP inflation",
    body: [
      "The harmonised measure the ECB targets at 2% over the medium term, compiled to a common methodology across member states so national rates are comparable.",
      "Note a methodological break: euro area HICP changed methodology in February 2026, so comparisons spanning that date are not strictly like-for-like.",
    ],
  },
  ea_depo_rate: {
    title: "ECB deposit facility rate",
    body: [
      "The rate paid on banks' overnight deposits at the Eurosystem. With ample excess liquidity this is the rate that anchors short-term money market rates, making it the effective policy rate rather than the main refinancing rate.",
    ],
  },
  us_yield_spread: {
    title: "The 10-year minus 2-year spread",
    body: [
      "The most cited yield curve measure. Sustained inversion has preceded every US recession in the modern record, with long and variable lags typically measured in quarters.",
      "Two standard cautions. First, research at the Federal Reserve has argued that shorter-horizon spreads carry at least as much information as the 10y-2y. Second, the re-steepening that follows an inversion — not the inversion itself — has historically been the part that coincides with the downturn.",
    ],
  },
  cr_hy_oas: {
    title: "US high yield spread",
    body: [
      "The option-adjusted spread of high yield corporate bonds over Treasuries — the compensation demanded for default risk, with the effect of embedded options stripped out. This is the direct measure; the HYG/IEF ratio elsewhere on this page is only a proxy for it.",
      "One of the most-watched inputs to financial-conditions indices, because credit availability binds on the real economy before earnings do. Spreads are mean-reverting and asymmetric: they grind tighter slowly and gap wider quickly, so a very tight level is less a bullish signal than a statement that little cushion remains.",
    ],
  },
  cr_ig_oas: {
    title: "US investment grade spread",
    body: [
      "The same measure for investment grade credit. It moves less than high yield but is more closely tied to the cost of capital for large borrowers, so it matters more for corporate investment decisions.",
      "The gap between investment grade and high yield spreads is itself informative: widening concentrated in high yield points to credit-quality concern, while both widening together points to a broader liquidity or rate shock.",
    ],
  },
  de_bund_10y: {
    title: "German 10-year bund yield",
    body: [
      "The euro area's risk-free benchmark. Other sovereign yields in the bloc are quoted as spreads to it, making those spreads the market's running assessment of fragmentation and redenomination risk.",
    ],
  },
  cmd_nickel: {
    title: "Nickel",
    body: [
      "An industrial metal used in stainless steel and battery chemistries. Kept on official monthly IMF data here because exchange nickel pricing has no reliable free live feed.",
      "Supply is unusually concentrated by producing country, so price moves frequently reflect supply policy and disruption rather than demand — treat it with more caution than copper as a growth signal.",
    ],
  },
};
