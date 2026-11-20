# Where and when Thailand's rice methane is emitted, and what satellites add

Where in Thailand does rice methane come from, and when is it emitted? Thailand's first Biennial Transparency Report (BTR1) gives a national total. This project estimates how emissions are distributed across provinces, within provinces on a 0.1° grid (about 10 km), and across the months of the year.

- [Open the interactive map](https://tiwariss.github.io/thailand-rice-methane/)
- [Read the report (PDF)](report/Thailand_rice_methane_report.pdf)
- [Download the data (CSV)](data_csv/) and see the [data notes](data_csv/README.txt)

## Explore the maps

- **Annual map, 1988–2024.** Use the year slider or select a province to see its emissions and rank. The map can show total, water-controlled, or rain-fed rice emissions. Use **+ Compare** to compare up to four provinces and the **10 km detail** switch to see the estimated grid within a selected province. The annual trend chart marks the official BTR1 totals for 2000–2022 with dots.
- **Monthly map.** Move the slider through the months or to **Whole year**. Choose a region in the chart to focus the map on that region, or select a province to see its seasonal pattern. The grid uses average rice area for 2022–24 and satellite flooding dates from May 2022 to May 2023.
- **On a phone.** The desktop layout opens zoomed out. Pinch outside the map to enlarge the page, or rotate the phone for more room.

The annual map shows **77 provinces from 2012 onward**. Bueng Kan is grouped with Nong Khai through 2011. Three other historical splits are shown with their former provinces through 1993. The ranking uses up to three years of data and starts a new averaging window in 2012 so it compares consistent reporting areas.

## How to read the estimates

The annual map combines harvested rice areas from Thailand's Office of Agricultural Economics (OAE) with BTR1's 2022 emission factors and national water-regime shares. The 10 km grid uses satellite data to estimate where rice and irrigation occur within provinces. The monthly calendar estimates emission timing from flooding dates. A grid value is an estimated allocation, and the report explains the checks and limits of that allocation.

Each file has a header row with units in the emissions column names. **Gg** means gigagrams, equivalent to 1,000 tonnes.

| File | What it contains |
| --- | --- |
| [Provincial annual estimates](data_csv/provinces_annual.csv) | Total, water-controlled, and rain-fed CH₄ by province and year, in Gg CH₄ per year |
| [Thailand annual estimates](data_csv/national_annual.csv) | National sums, reporting-area counts, and the official BTR1 comparison, in Gg CH₄ per year |
| [Monthly grid](data_csv/grid_monthly.csv) | Coordinates and estimated CH₄ by cell, in tonnes per month and per year |
| [Grid by province](data_csv/grid_by_province.csv) | Estimated CH₄ assigned to each province's portion of a cell, in tonnes per year |

## Run it offline

Download or clone the repository, then open `index.html` in a browser. The map, report, and CSVs are included here. The analysis workflow is maintained separately.

## Sources and licences

- Thailand BTR1 (2024), UNFCCC, and OAE rice statistics. See the report for the input sources and methods.
- Open-SEA-Rice-10 (Ginting et al., 2025, Zenodo 10.5281/zenodo.14627003) and its 0.1° gridding by Casas and Ismail (2026, Zenodo 10.5281/zenodo.20453139), both CC BY 4.0.
- Natural Earth province outlines and basemap are public domain and simplified for display.
- Leaflet 1.9.4 (BSD 2-Clause) and D3 7.9.0 (ISC). See the [bundled licence texts](vendor/LICENSES.txt).

Author: Sirawit Tangchitwatthanakon, The Hong Kong University of Science and Technology (Guangzhou), 2026.
