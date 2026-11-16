# Generated photo-privacy regression fixtures

These files contain no private photos or account data. They were generated for the retained offline review on 2026-11-16; the full package remains outside the checkout. Production code does not read this directory.

| File | Purpose | SHA-256 |
| --- | --- | --- |
| metadata.jpg | Synthetic EXIF 1, GPS/owner/camera/date/serial/maker note, JPEG thumbnail, XMP, IPTC and comment; colored corners | 56a396768618559b2ba9f3aaa0a55cc33b7d4905ab84c7ca0505c61e94150ed5 |
| fine-mesh.jpg | Deterministic high-frequency synthetic RGB/detail/gradient chart, fixed saved JPEG; Q95/4:4:4 regression only | 188ddf97942b735e33e74a838665585aa369bfa687349c8cf82975f0995d8adb |
| alpha.png | Generated semi-transparent edges, hidden RGB, text metadata and deliberately unsupported private PNG ancillary chunk | 378577a42647a10ae7352609d537bdd596d7bb730eccd0e3544e6689d605783a |
| other-valid-srgb.icc | Generated Pillow/LittleCMS sRGB profile; valid but intentionally outside the exact two-profile JPEG allowlist | e2679898fb418111b8b00c7edef6a8d13ae902567e20cb4ff32e069b6f40fc05 |

Tests derive explicitly named variants in memory. The valid-alpha case removes the unsupported fixture-only chunk before treating that generated variant as its saved source; production never silently removes unsupported source metadata to make admission pass. All tests check the saved source is unchanged. Numeric JPEG quality evidence is specific to this chart and pinned encoder, not a universal fidelity or real-provider claim.
