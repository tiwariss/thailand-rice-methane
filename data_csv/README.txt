Data behind the Thailand rice methane dashboard (CSV, UTF-8).
Reference period of the grid: Reference period: rice area = 2022–24 average (OAE); planting dates = May 2022 – May 2023 (MODIS)
provinces_annual.csv: rice CH4 by province and year, 1988-2024, Gg CH4 per year; our calculation (official OAE rice area each year x BTR1 2022 emission factors and shares). Empty = no data.
national_annual.csv: Thailand sums of the above; btr1_official_total_Gg_CH4 = Thailand's official national rice CH4, BTR1 Table 2-136 (kt CO2-eq / 28), 2000-2022. 1988-1993 have 73 provinces: Amnat Charoen, Nong Bua Lamphu and Sa Kaeo were created in 1993 and are included in Ubon Ratchathani, Udon Thani and Prachin Buri until then, so the national sums are complete.
grid_monthly.csv: 0.1-degree cells, t CH4 per month and per year, estimated allocation within provinces (2022-24 rice area).
grid_by_province.csv: cells allocated to each province, t CH4 per year.
