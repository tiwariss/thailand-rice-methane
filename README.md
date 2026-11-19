# Thailand rice methane: provinces, 10 km grid and months

Interactive map and report on where and when Thailand's rice methane (CH₄) is emitted. Thailand's first Biennial Transparency Report (BTR1) gives rice methane at national scale; this work spreads that inventory across the 77 provinces (shown as 76: Bueng Kan is included in Nong Khai), places it on a 0.1° (~10 km) grid and spreads it over the months of the year.

- **Open the map:** https://tiwariss.github.io/thailand-rice-methane/
- **Report (PDF):** [report/Thailand_rice_methane_report.pdf](report/Thailand_rice_methane_report.pdf)
- **Data (CSV):** [data_csv/](data_csv/), described in [data_csv/README.txt](data_csv/README.txt)

## What the map shows
- **Provinces, 1988–2024:** rice CH₄ per province and year (Gg CH₄ per year), as total, water-controlled (irrigated main season plus dry-season rice) or rain-fed. Search a province, play the years, open its trend and rank. The national total for the year is shown with BTR1's official value for 2000–2022.
- **10 km detail:** select a province to see its rice methane on the 0.1° grid (2022–24 rice area). Areas without rice read as 0.
- **Seasonal grid:** the 0.1° grid month by month (planting dates May 2022 – May 2023); August to November carries most of the year's methane.

## How the numbers are made
- Provincial values: official rice area by province (Office of Agricultural Economics, OAE) for each year, with BTR1's 2022 emission factors and national shares of irrigated (26.30%) and flood-prone (11.09%) rice. 2022 reproduces BTR1's national total; for 2000–2021 the national sums stay within 2% of BTR1's official series. All other years and every provincial value are our calculation, not official statistics.
- 10 km grid and months: rice placed within each province with Open-SEA-Rice-10 and a Sentinel-2 dry-season water signal; months from MODIS flooding dates. These are estimated allocations and are not validated at cell level.
- Full method, checks and limits: see the report.

## Run it offline
Download or clone this repository and open `index.html` in a browser. Everything it needs is included (`vendor/`, `data/`).

## Sources and licences
- Thailand BTR1 (2024), UNFCCC; OAE rice statistics.
- Open-SEA-Rice-10 (Ginting et al., 2025; Zenodo 10.5281/zenodo.14627003) and its 0.1° gridding by Casas and Ismail (2026; Zenodo 10.5281/zenodo.20453139), both CC BY 4.0. The grid here is derived from them.
- Province outlines and basemap: Natural Earth (public domain), simplified for display.
- Libraries: Leaflet 1.9.4 (BSD 2-Clause) and D3 7.9.0 (ISC); licence texts in [vendor/LICENSES.txt](vendor/LICENSES.txt).

Author: Sirawit Tangchitwatthanakon, The Hong Kong University of Science and Technology (Guangzhou), 2026.
