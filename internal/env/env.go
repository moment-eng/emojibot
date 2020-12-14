package env

import (
	"fmt"
	"os"
)

// GetOrDefault reads an environment or return a default value
func GetOrDefault(key string, defaultVal string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}

	return defaultVal
}

// Reads an environment variable and returns the value set or the default value if unset.
// This will return an error if the value is set to non-truthy/falsy values. See ToBool for more details.
func GetBoolOrDefault(key string, defaultVal bool) (bool, error) {
	dm, exists := os.LookupEnv(key)

	if !exists {
		return defaultVal, nil
	}

	value, successfullyConverted := ToBool(dm)

	if !successfullyConverted {
		return false, fmt.Errorf("Got a value that did not convert properly to boolean")
	}

	return value, nil
}

// ToBool attempts to convert an env var to a bool, and returns it along with a bool indicating
// whether the conversion was successful. For example, `true`, `false`, `1`, and so on, all convert
// to bool, but the string "NOT_A_BOOL" does not.
// `false`, `false` means the environment vairable did not convert properly.
func ToBool(val string) (bool, bool) {
	if val == "true" || val == "True" || val == "1" {
		return true, true
	} else if val == "false" || val == "False" || val == "0" {
		return false, true
	}
	return false, false
}
