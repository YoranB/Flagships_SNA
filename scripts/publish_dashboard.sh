#!/usr/bin/env bash
set -e

python3 -m sna_pipeline
mkdir -p docs
cp output_sna/person_network_interactive.html docs/index.html

echo "Dashboard copied to docs/index.html"
