# Talks, videos, and non-written primary/secondary sources

No video was downloaded (out of scope) — this file records titles, URLs, and what's recoverable about content without a transcript.

## Alexander Sannikov — ExileCon 2023: "Rendering Path of Exile 2"
- YouTube: https://www.youtube.com/watch?v=TrHHTQqmAaM
- This is the primary talk where Radiance Cascades was first publicly presented (per the PoE forum thread and 80.lv article, Nov 2023).
- LinkedIn pointer from Sannikov himself: https://www.linkedin.com/posts/alexander-sannikov-9964aa188_exilecon-2023-rendering-path-of-exile-2-activity-7127539402737684481-M2h3
- No GDC talk on this topic was found in this search pass — multiple sources (search results) explicitly note ExileCon 2023 is the presentation venue, not GDC. If a GDC Vault talk exists it is not indexed publicly under an obvious title; treat "GDC talk" as unconfirmed/likely not existing separately from the ExileCon talk.
- No independent community transcript was located; the paper (`sannikov-paper.pdf`) is the closest thing to a written version of the talk's content, and is presumably a more rigorous superset.

## Sannikov's earlier LinkedIn teasers (pre-paper, informal announcements)
- "2d Full Global Illumination #2 (working principle and perf tests)": https://www.linkedin.com/posts/alexander-sannikov-9964aa188_2d-full-global-illumination-2-working-principle-activity-6971066712209203200-U_le
- These predate the formal paper and the ExileCon talk — useful for tracing the technique's development timeline if that matters, but carry no additional technical detail beyond what's in the paper.

## SimonDev — "Exploring a New Approach to Realistic Lighting: Radiance Cascades"
- YouTube: https://youtu.be/3so7xdZHKxw (also indexed as https://www.youtube.com/watch?v=3so7xdZHKxw)
- Announcement: https://x.com/iced_coffee_dev/status/1808162127271575875 — "Did a video exploring Radiance Cascades... Demo and video both made in #threejs!" — **directly relevant**: this is a three.js-based exploration, same stack as this project.
- Mastodon mirror of the same announcement: https://mastodon.gamedev.place/@SimonDev/112719744365902161
- Companion repo (2D GLSL implementation used in the video): https://github.com/simondevyoutube/Shaders_RadianceCascades — page https://simondevyoutube.github.io/Shaders_RadianceCascades/ (WebFetch returned only the page title, no body content; treat the GitHub repo as the substantive artifact, not the GitHub Pages front-end).
- Referenced directly by other implementers as a code source — e.g. tlegoc's `MergeCascades.slang` cites a specific commit of this repo for its angle-interpolation logic (see `tlegoc-vulkan-implementation.md`).
- Project listing: https://simondev.io/projects ("This project explored the Radiance Cascades...").

## Community discord ecosystem (not independently archived)
Multiple secondary sources (HN thread, radiance.wiki, GM Shaders posts) name the same cluster of contributors active in the Graphics Programming Discord's RC thread: **Alexander Sannikov himself, Yaazarai, fad, tmpvar, Mytino, Goobley, Sam**, and others. No public archive/export of that Discord thread was found — this project's understanding of "what the discord discussed" is necessarily mediated through the secondary writeups (tmpvar's site, GM Shaders posts, radiance.wiki) that credit it, rather than the raw discussion itself. Flag this as a residual gap: if deeper Discord-native discussion (e.g. on SSRC specifically) is needed, it likely requires manually joining and searching the Graphics Programming Discord server, which is outside this research pass's tool access.
