#!/usr/bin/env bash
# Reproduces the carrier counts in research/02-industries.md and 05-market-size.md.
# Source: FMCSA Company Census File, data.transportation.gov dataset az4n-8mr2 (Socrata API, no key needed).
# Run: bash research/scripts/fmcsa_carrier_counts.sh   (results change as FMCSA updates the file)
B="https://data.transportation.gov/resource/az4n-8mr2.json"
q(){ printf '%s\t' "$(curl -s -m 120 -G "$B" --data-urlencode "\$select=count(*)" --data-urlencode "\$where=$1")"; echo "$1"; }
base="status_code='A' AND carrier_operation='A' AND classdef like '%AUTHORIZED FOR HIRE%'"
recent="$base AND mcs150_date >= '20241017'"
q "$base"
q "$base AND power_units::number >= 1 AND power_units::number <= 4"
q "$base AND power_units::number >= 5 AND power_units::number <= 10"
q "$base AND power_units::number >= 11 AND power_units::number <= 100"
q "$base AND power_units::number >= 5 AND power_units::number <= 100"
q "$base AND power_units::number > 100"
q "$recent"
q "$recent AND power_units::number >= 5 AND power_units::number <= 100"
q "$recent AND power_units::number >= 5 AND power_units::number <= 100 AND crgo_genfreight='X'"
