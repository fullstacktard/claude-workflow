---
id: video-{id}
title: "{title}"
status: Draft
created_date: "{date}"
updated_date: "{date}"

# === REQUIRED ===
url: ""
platform: ""  # twitter | instagram | github | general

# === FORMAT ===
output_format: mp4  # mp4 | webm | gif
dimensions:
  width: 1920
  height: 1080
device_scale_factor: 2  # Retina/HiDPI - outputs 3840x2160 pixels with correct CSS layout
quality: 100
fps: 60

# === VISUAL STYLE ===
device_frame: browser  # browser | phone | laptop | tablet | none
device_frame_dark: true
background_color: "linear-gradient(135deg, #667eea, #764ba2)"

# === EFFECTS ===
enable_cursor: true
enable_zoom: true
enable_ripple: true
enable_motion_blur: false
enable_captions: false
caption_position: bottom  # top | center | bottom

# === AUDIO ===
background_music: ""
music_volume: 0.3
sound_effects: false
---

## Scenes

<!-- SECTION:SCENES:BEGIN -->
<!--
Define scenes sequentially. Each scene has a name and a list of actions.

### Scene 1: {Scene Name}

{Description of what this scene shows}

**Actions:**
- wait: 2000
- click: "#selector-or-.class"
- type: selector="#input-selector" text="text to type"
- scroll: 600
- navigate: "https://url-to-navigate-to"

### Scene 2: {Scene Name}

{Description}

**Actions:**
- wait: 1500
- click: ".submit-button"
-->
<!-- SECTION:SCENES:END -->

## Annotations

<!-- SECTION:ANNOTATIONS:BEGIN -->
<!--
Caption text displayed during each scene (only used if enable_captions: true).

- Scene 1: "Welcome to our application"
- Scene 2: "Click the button to get started"
- Scene 3: "Here's the dashboard overview"
-->
<!-- SECTION:ANNOTATIONS:END -->

## Lottie Overlays

<!-- SECTION:LOTTIE:BEGIN -->
<!--
Optional animated overlays. Each overlay needs:

- src: "path/to/animation.json"
  position: "top-right"
  timing: "scene-1-start"
  scale: 1
  duration: 3000

- src: "path/to/confetti.json"
  position: "center"
  timing: "scene-3-end"
  scale: 1.5
  duration: 2000
-->
<!-- SECTION:LOTTIE:END -->

## Validation

- [ ] URL is set and valid
- [ ] Platform is selected
- [ ] At least 1 scene defined with name and actions
- [ ] All click actions have selectors
- [ ] All type actions have selectors and text
- [ ] If captions enabled, annotations provided for each scene
- [ ] Status set to "Ready"
