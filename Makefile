.PHONY: help install build clean lint format typecheck test test-cov

help:
	@echo "dagstack-logger-typescript — TypeScript binding for dagstack/logger-spec"
	@echo ""
	@echo "Targets:"
	@echo "  install       npm install"
	@echo "  build         tsc -p tsconfig.build.json"
	@echo "  clean         rm dist / coverage / .tsbuildinfo"
	@echo "  lint          eslint ."
	@echo "  format        prettier --write ."
	@echo "  typecheck     tsc --noEmit"
	@echo "  test          vitest run"
	@echo "  test-cov      vitest run --coverage"

install:
	npm install

build:
	npm run build

clean:
	npm run clean

lint:
	npm run lint

format:
	npm run format

typecheck:
	npm run typecheck

test:
	npm run test

test-cov:
	npm run test:cov
