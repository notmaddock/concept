# Changelog

## [0.3.0](https://github.com/notmaddock/concept/compare/v0.2.0...v0.3.0) (2026-11-13)


### Features

* **editor:** add shared shortcuts and help reference ([a437949](https://github.com/notmaddock/concept/commit/a4379492056fd08a23225762a9dafc0f6dfaeb3c))
* **editor:** fix slash navigation and add keyboard shortcuts ([#30](https://github.com/notmaddock/concept/issues/30)) ([9102df8](https://github.com/notmaddock/concept/commit/9102df8f6cbcf7b6f1056e63d354a0c2a087f731))
* **editor:** warn about paper layout export differences ([b1c35dd](https://github.com/notmaddock/concept/commit/b1c35dd9feb0c5c3b665659a6ffae15d9a7c2121))
* **nova:** add code blocks with prism highlighting ([#28](https://github.com/notmaddock/concept/issues/28)) ([8521117](https://github.com/notmaddock/concept/commit/85211172d139ee3daa6715cbf65f53ba156005a6))


### Bug Fixes

* **editor:** make slash menu navigation sequential ([3b00f43](https://github.com/notmaddock/concept/commit/3b00f438bd2f6b4147d7ad970ed2c1ab5f932f07))
* **editor:** match slash menu rounding to menu bar ([7cea3a4](https://github.com/notmaddock/concept/commit/7cea3a4a8a5db276be1e191c5adfc79b2568d63a))
* **nova:** match code block radius to inset controls ([8bdf339](https://github.com/notmaddock/concept/commit/8bdf33957c21c85fe277393f7ed94c7d35379a4c))
* **nova:** reduce code action toolbar inset ([44ae81c](https://github.com/notmaddock/concept/commit/44ae81c5cc1b2506b49099ba759d305f599fd45b))
* **nova:** restore natural code action control rounding ([26e06f2](https://github.com/notmaddock/concept/commit/26e06f2bdf7d90da7cee8d49c152eb9b8a2798be))
* organize deployments and refine code block controls ([4ea5454](https://github.com/notmaddock/concept/commit/4ea545401987050996bfcce2520461843d3d6634))

## [0.2.0](https://github.com/notmaddock/concept/compare/v0.1.0...v0.2.0) (2026-11-12)


### Features

* **ci:** budget the whole initial bundle graph ([6085fc2](https://github.com/notmaddock/concept/commit/6085fc2a016f2cf0a7d4def5ef8bec2bd27a9bac))
* **documents:** preserve exportable html classes ([5976948](https://github.com/notmaddock/concept/commit/5976948ef792f956773bf5f65721e7e60c7eefd8))
* **documents:** surface markdown import warnings ([af0be6d](https://github.com/notmaddock/concept/commit/af0be6d20218a96b7cb94dc4953ab9327125ba7a))
* **editor:** add link node and autolink ([1b81199](https://github.com/notmaddock/concept/commit/1b81199e9e25ee0e449560723cd11fe6d211ad84))
* **editor:** complete phase 0 editor foundations ([77f179c](https://github.com/notmaddock/concept/commit/77f179c74661e168f0c9e673fdfdcf547b349513))
* **editor:** register code node ([7e636d2](https://github.com/notmaddock/concept/commit/7e636d2abe826fb52374664012a6fff5a1d66be0))
* **worker:** add csp and iframe policy ([6d2eb28](https://github.com/notmaddock/concept/commit/6d2eb28992f062ac7ff96e6b02de4ec8b0cbaca3))


### Bug Fixes

* **documents:** accept spaced tel links ([0f30b64](https://github.com/notmaddock/concept/commit/0f30b6418eda14f90cb8b7866b317db1af27019a))
* **documents:** apply link policy to html export ([090fd56](https://github.com/notmaddock/concept/commit/090fd56339a7f32fb0fe63ca585ed054662c9ee3))
* **documents:** name import warnings in the toast ([b9d235a](https://github.com/notmaddock/concept/commit/b9d235a6317f4bdc714c39d7e761900fad330b43))
* **documents:** treat page nodes as reference-free ([7826aaf](https://github.com/notmaddock/concept/commit/7826aafea18b8eaeff8a6542ae2d69dbc828c6cb))
* **editor:** close the link preview after removing an autolink ([478664c](https://github.com/notmaddock/concept/commit/478664cb6762d48c03cb32bdc391b24b7aa788f6))
* **editor:** compute link state for the floating toolbar ([4bda01e](https://github.com/notmaddock/concept/commit/4bda01efb4fca4fea1221ef3f0ebfa07fb8ebf5c))
* **editor:** describe the link dialog for assistive tech ([3f8617e](https://github.com/notmaddock/concept/commit/3f8617e4e0c55cd985403b51cebc3db32ec41e71))
* **editor:** open the link dialog without a stored selection ([08023ff](https://github.com/notmaddock/concept/commit/08023ffad13779c6f0ed20570801ee542fa6e461))
* **editor:** stabilize link editing and autolink policy ([8e895a2](https://github.com/notmaddock/concept/commit/8e895a2ac1c419f2e926634ec836886e8fc6cbf2))
* **editor:** stabilize link editing, normalize export links, and preserve token classes ([f64c679](https://github.com/notmaddock/concept/commit/f64c6795fbf152ba347d38f52b56807274ce6152))
* **worker:** allow drive picker origins in csp ([2474520](https://github.com/notmaddock/concept/commit/247452033e5a18eb8a9d52bff3c1050c8aafb557))
* **worker:** share embed hosts and narrow connect-src ([a70cda0](https://github.com/notmaddock/concept/commit/a70cda09a74e4a17728ae56bc2cdae2c7f0b7ce7))

## [0.1.0](https://github.com/notmaddock/concept/releases/tag/v0.1.0) (2026-11-10)

### Highlights

* First tagged release: local and Google Drive documents, realtime collaboration, image embedding, document themes, import/export, and paged documents.

### Features

* **editor:** add automatic pagination, manual page breaks, and page setup
* **changelog:** add in-app release notes with a "What's new?" prompt and a Help menu entry
* **release:** add release-please versioning, generated changelogs, and release-gated production deploys

### Bug Fixes

* **editor:** keep page content height natural and reflow pages after fonts load
* **editor:** polish paged layout edge cases
