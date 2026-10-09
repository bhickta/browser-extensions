VERSION := $(shell node -p "require('./manifest.json').version")
PACKAGE := dist/smart-video-skipper-$(VERSION).zip
TSC := npx --yes -p typescript tsc
SOURCES := src/shared.ts src/content.ts src/popup.ts src/types.d.ts
BUILT := js/shared.js js/content.js js/popup.js
FILES := manifest.json js content.css popup.html popup.css README.md LICENSE \
	icons/icon-16.png icons/icon-19.png icons/icon-32.png icons/icon-38.png \
	icons/icon-48.png icons/icon-96.png icons/icon-128.png

.PHONY: build typecheck check package clean

build: $(BUILT)

$(BUILT): $(SOURCES) tsconfig.json
	$(TSC) -p tsconfig.json

typecheck:
	$(TSC) -p tsconfig.json --noEmit

check: build
	python3 -m json.tool manifest.json >/dev/null
	node --check js/shared.js
	node --check js/content.js
	node --check js/popup.js

package: check
	mkdir -p dist
	zip -q -r -9 $(PACKAGE) $(FILES)
	@echo "Created $(PACKAGE)"

clean:
	rm -f $(PACKAGE) $(BUILT)
