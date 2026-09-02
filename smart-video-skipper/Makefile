VERSION := 3.0.0
PACKAGE := dist/smart-video-skipper-$(VERSION).zip
FILES := manifest.json content.js content.css popup.html popup.js popup.css README.md LICENSE

.PHONY: package check clean

check:
	python3 -m json.tool manifest.json >/dev/null
	node --check content.js
	node --check popup.js

package: check
	mkdir -p dist
	zip -q -9 $(PACKAGE) $(FILES)
	@echo "Created $(PACKAGE)"

clean:
	rm -f $(PACKAGE)
