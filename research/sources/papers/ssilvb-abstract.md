# SSILVB Paper - Abstract & Metadata

**Title:** Screen Space Indirect Lighting with Visibility Bitmask

**Authors:** Olivier Therrien, Yannick Levesque, Guillaume Gilet

**arXiv ID:** 2301.11376

**Publication:** Visual Computing (Vis Comput), 2022

**Abstract:**

The paper introduces a visibility bitmask concept that improves upon horizon-based indirect illumination methods. Rather than using two horizon angles, this approach employs "a bit field representing the binary state (occluded / un-occluded) of N sectors uniformly distributed around the hemisphere slice." The technique enables light simulation behind thin surfaces while maintaining computational efficiency. It provides superior visual quality for ambient occlusion and indirect diffuse lighting with reduced noise compared to prior screen space approaches.

## Version History

- **v1:** Submitted January 26, 2023
- **v2:** Revised January 31, 2023 (current version)

**DOI:** 10.48550/arXiv.2301.11376

## Key Concepts

- **Core Innovation:** Visibility bitmask replacing traditional dual horizon angles
- **Application:** Screen-space indirect lighting (SSILVB) and screen-space ambient occlusion (SSAO)
- **Improvement over:** GTAO (Ground Truth Ambient Occlusion), prior SSAO methods
- **Key Advantage:** Allows light to pass behind constant-thickness surfaces while maintaining computational efficiency
- **Output:** Superior visual quality with reduced noise in both ambient occlusion and indirect diffuse lighting
