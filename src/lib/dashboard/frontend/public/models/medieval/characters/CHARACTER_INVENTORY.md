# Character Model Inventory

## Overview

This document tracks all 3D character models available for the medieval village visualization. Models are used to represent different agent types in the visualization.

**Total Models Available:** 12 User-Provided + 5 Recommended Downloads = 17 characters

---

## User-Provided Models (12 total)

| Name | Format | File Size | Status | Notes |
|------|--------|-----------|--------|-------|
| base-retardio | GLB | 632 KB | Ready | Primary character model |
| retardio-red | GLB | 3.0 MB | Ready | Red variant |
| shrek | GLB | 5.3 MB | Ready | Ogre character |
| spider | GLB | 19.2 MB | Ready | Large file - may need optimization |
| vape | GLB | 899 KB | Ready | Default fallback character |
| yakub | GLB | 4.2 MB | Ready | |
| blaxk | GLB | 1.4 MB | Ready | |
| jocker | GLB | 192 KB | Ready | Lightweight |
| donkey-kong | GLTF | 3.4 KB | Ready | Uses external assets in subfolder |
| caroline | GLB | 756 KB | Ready | |
| sbf | GLB | 719 KB | Ready | |

---

## Recommended Downloads (5 total)

These models complement the user-provided collection and provide variety for different agent types. All are CC0 licensed (free for any use, no attribution required).

### Model 1: Quaternius RPG Characters Pack

| Attribute | Value |
|-----------|-------|
| **Source** | https://quaternius.com/packs/rpgcharacters.html |
| **Alt Download** | https://opengameart.org/sites/default/files/rpg_characters_-_nov_2020.zip |
| **License** | CC0 (Public Domain) |
| **Format** | FBX, OBJ, Blend, glTF |
| **Models Included** | 6 characters (Wizard, Warrior, Rogue, Monk, Ranger, etc.) |
| **Polygon Count** | Low-poly (estimated <5,000 per character) |
| **Rigged/Animated** | Yes - fully rigged and animated |
| **File Size** | 12.9 MB |
| **Recommended For** | cto-architect (Wizard), research (Scholar/Monk), general-purpose (Warrior) |

**Why Selected:** Provides diverse fantasy RPG characters that perfectly fit medieval theme. Multiple character types in one pack offers variety. Quaternius models are already used for medieval buildings, ensuring consistent art style.

---

### Model 2: Quaternius Animated Knight

| Attribute | Value |
|-----------|-------|
| **Source** | https://quaternius.itch.io/lowpoly-animated-knight |
| **License** | CC0 (Public Domain) |
| **Format** | FBX, OBJ, Blend |
| **Models Included** | 1 knight character |
| **Polygon Count** | Low-poly (estimated <3,000) |
| **Rigged/Animated** | Yes - Idle, Death, Jump, Roll, Run, Walk, Attack animations |
| **File Size** | 8 MB |
| **Recommended For** | backend-engineer (heavy armored = heavy lifting) |

**Why Selected:** Medieval knight with comprehensive animations. Consistent style with other Quaternius assets. Perfect for representing robust backend work.

---

### Model 3: KayKit Adventurers Pack

| Attribute | Value |
|-----------|-------|
| **Source** | https://kaylousberg.itch.io/kaykit-adventurers |
| **GitHub** | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 |
| **License** | CC0 (Public Domain) |
| **Format** | FBX, GLTF |
| **Models Included** | 5 characters (free version) - includes various adventurer types |
| **Polygon Count** | Low-poly (optimized for games) |
| **Rigged/Animated** | Yes - fully rigged with animations |
| **File Size** | 12 MB |
| **Recommended For** | feature-planner (Explorer/Scout), devops-engineer (Ranger) |

**Why Selected:** Stylized low-poly adventurers with variety. CC0 license allows unrestricted use. Includes GLTF format for direct web use.

---

### Model 4: KayKit Skeletons Pack

| Attribute | Value |
|-----------|-------|
| **Source** | https://kaylousberg.itch.io/kaykit-skeletons |
| **GitHub** | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 |
| **License** | CC0 (Public Domain) |
| **Format** | FBX, GLTF |
| **Models Included** | 4 skeleton types (Base, Warrior, Archer, Mage) + accessories |
| **Polygon Count** | Low-poly (optimized for games) |
| **Rigged/Animated** | Yes - 90+ animations included |
| **File Size** | ~10 MB |
| **Recommended For** | debugger (Skeleton Mage - finding dead code/bugs) |

**Why Selected:** Unique skeleton characters add visual variety. Mage skeleton is thematically fitting for "debugging" (finding what's dead/broken). Extensive animation library.

---

### Model 5: Kenney Blocky Characters

| Attribute | Value |
|-----------|-------|
| **Source** | https://kenney.nl/assets/blocky-characters |
| **License** | CC0 (Public Domain) |
| **Format** | FBX, GLTF, Blend |
| **Models Included** | 20 character files |
| **Polygon Count** | Ultra low-poly (blocky/voxel style) |
| **Rigged/Animated** | Yes |
| **File Size** | Small (blocky style) |
| **Recommended For** | qa-engineer (simple/systematic), code-reviewer |

**Why Selected:** Blocky style provides visual contrast. Very lightweight for web performance. CC0 from Kenney (highly trusted source). Recently remastered (v2.0 June 2025).

---

## Agent Type Mapping Recommendations

| Agent Type | Primary Model | Fallback | Reasoning |
|------------|---------------|----------|-----------|
| **frontend-engineer** | shrek | vape | Visible/user-facing work |
| **backend-engineer** | Knight (Quaternius) | donkey-kong | Heavy lifting, robust |
| **cto-architect** | Wizard (RPG Pack) | yakub | Strategic planning/design |
| **task-maker** | base-retardio | vape | Primary coordinator |
| **debugger** | Skeleton Mage (KayKit) | jocker | Finding dead/broken code |
| **devops-engineer** | Ranger (KayKit Adventurers) | spider | Infrastructure scouting |
| **qa-engineer** | Blocky Character (Kenney) | retardio-red | Systematic testing |
| **code-reviewer** | Rogue (RPG Pack) | blaxk | Detailed inspection |
| **feature-planner** | Explorer (KayKit Adventurers) | caroline | Planning/exploration |
| **research** | Monk (RPG Pack) | sbf | Knowledge gathering |
| **general-purpose** | Warrior (RPG Pack) | vape | Versatile |
| **default** | vape | (capsule geometry) | Reliable fallback |

---

## Download Instructions

### Quaternius Assets

1. **RPG Characters Pack:**
   - Visit: https://quaternius.com/packs/rpgcharacters.html
   - Click "Download" button
   - Or direct from OpenGameArt: https://opengameart.org/sites/default/files/rpg_characters_-_nov_2020.zip

2. **Animated Knight:**
   - Visit: https://quaternius.itch.io/lowpoly-animated-knight
   - Click "Download Now" (name your own price, $0 is acceptable)

### KayKit Assets

3. **Adventurers Pack:**
   - Visit: https://kaylousberg.itch.io/kaykit-adventurers
   - Click "Download Now" (name your own price, $0 is acceptable)
   - Select "Free 2.0" tier

4. **Skeletons Pack:**
   - Visit: https://kaylousberg.itch.io/kaykit-skeletons
   - Click "Download Now" (name your own price, $0 is acceptable)
   - Or from GitHub: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0

### Kenney Assets

5. **Blocky Characters:**
   - Visit: https://kenney.nl/assets/blocky-characters
   - Click "Download" button
   - Optional donation appreciated but not required

---

## Format Conversion Notes

- **GLTF/GLB:** Web-ready, no conversion needed
- **FBX:** Requires conversion to GLTF/GLB
  - Use Blender: Import FBX, Export as GLTF
  - Online: https://anyconv.com/fbx-to-gltf-converter/
- **Blend:** Open in Blender, Export as GLTF/GLB

**Conversion will be handled in task-1058.**

---

## File Placement

After downloading and converting, place models in:
```
packages/claude-workflow/src/lib/dashboard/frontend/public/models/medieval/characters/
```

Recommended naming convention:
- `knight-quaternius.glb`
- `wizard-rpg.glb`
- `adventurer-kaykit.glb`
- `skeleton-mage-kaykit.glb`
- `blocky-kenney.glb`

---

## Last Updated

- **Date:** 2026-01-21
- **Updated By:** Research Agent
- **Task:** task-1056
