# Gather — mobile companion

Open `mobile.html`. This separate mobile prototype does not load either desktop application's JavaScript, styles, or saved state. The original and Fluent desktop files remain unchanged.

## Plan

- Create a service or switch between sample services.
- Add hymns, prayers, scripture, communion, sermons, and announcements.
- Edit titles, leaders, estimated duration, singing key, verses, and notes.
- Move items earlier/later, remove them, and view assignments grouped by person.

## Hymns

Search a twelve-hymn sample database by title, number, author, lyric fragment, theme, or scripture. Filter by theme/key, sort, save favorites, inspect metadata, and add songs to a service. There is no notation renderer, notated-music file, slide asset URL, or presentation control in the mobile app.

## Live

- Dark companion view showing current item, leader, notes, and next item/leader.
- Manual previous/next controls and a full-order picker; navigation does not control other devices.
- Explicit Start/Pause/Resume controls for service and item elapsed timers. Elapsed time continues across navigation, backgrounding, and reload while the timer is running. It never advances the order automatically.
- A working, user-triggered Web Audio pitch pipe for the current hymn. It defaults to the hymn's singing-key tonic, supports twelve chromatic pitches and octaves 3/4, uses equal temperament with A4 = 440 Hz, and has volume and stop controls.
- Pitch playback ramps in/out, stops after three seconds, and stops when changing item, opening a sheet, changing screens, hiding the page, or leaving it. No autoplay or microphone permission.
- The key tonic is a reference pitch; it is not assumed to be the melody's first note. A reference-note override is saved per service item without transposing the hymn.
- Finish the run to stop the timer and see a summary; the plan remains saved.

## Scope and implementation

Vanilla HTML/CSS/JavaScript with system fonts, inline interface icons, and no dependencies or external asset requests. Wide browser windows present the mobile app in a phone-sized canvas; real mobile widths fill the viewport with safe-area spacing and bottom navigation.

`mobile-data.js` contains sample metadata and fictional service assignments. `mobile.js` owns behavior, and `mobile.css` owns presentation. State is stored under `gather-mobile-v1` in localStorage. This is local browser storage, not server sync, an installed offline app, or a live connection to the desktop mockup.

The browser pitch pipe is a functional prototype; actual volume depends on device/browser audio routing. Validate native audio behavior and accessibility in the eventual Uno build and on target physical devices.

Audio implementation reference: [MDN Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices), including gesture-triggered audio and explicit playback controls.
