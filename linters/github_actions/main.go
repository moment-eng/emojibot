/*
	Validates all Github Workflows using the jsonschema definition.
	gojsonschema does not have yml support, so all the actions must be coverted to from yml to json for this check to work.
	ymltojson.sh script must be run first before this test can run.
*/
package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/xeipuuv/gojsonschema"
)

func main() {
	schemaLoader := gojsonschema.NewReferenceLoader("https://json.schemastore.org/github-workflow")

	err := filepath.Walk(".",
		func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				return nil
			}

			if !strings.HasSuffix(path, ".json") {
				return nil
			}

			fullpath, err := filepath.Abs(path)

			documentLoader := gojsonschema.NewReferenceLoader(fmt.Sprintf("file:///%s", fullpath))

			result, err := gojsonschema.Validate(schemaLoader, documentLoader)
			if err != nil {
				return err
			}

			if result.Valid() {
				log.Printf("%s is valid\n", path)
			} else {
				log.Printf("%s is not valid. see errors :\n", path)
				for _, desc := range result.Errors() {
					fmt.Printf("- %s\n", desc)
				}
				os.Exit(1)
			}
			return nil
		},
	)

	if err != nil {
		log.Fatalf("error: %v", err)
	}
}
