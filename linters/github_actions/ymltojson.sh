#!/bin/bash

# This script is used to copy all the github workflows into the working directory
# and convert them from yml to json.
# This is done in bash as converting them in Go resulted in malform json using "https://github.com/ghodss/yaml".
# However, I believe this is a bug with gopkg.in/yaml.v2
# and converting the yaml to map[string]interface struct first before converting to JSON.
# yq uses gopkg.in/yaml.v3, but has a bunch of extra logic as well.
# Thus we decided to use bash/yq for now unless it was necessary to convert everything to Go.

set -euo pipefail
IFS=$'\n\t'

cp -r ../../.github/workflows .
find ./workflows -depth -name '*.yml' -print0 | while IFS= read -r -d '' f; do
	yq r "$f" --tojson > "${f%.yml}.json"
done
