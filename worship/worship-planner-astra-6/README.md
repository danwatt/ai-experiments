# Gather — worship planner mockup

A self-contained HTML/CSS/JavaScript prototype for a churches of Christ worship planner. Created independently, without referencing other workspace code.

## Open

Open `index.html` directly, or serve this directory:

```sh
python3 -m http.server 4173
```

Visit http://localhost:4173. No installation or build step is required. Google Fonts is optional; local serif and sans-serif fallbacks work offline.

## Try

- Search the sample hymn library by title, lyric fragment, number, author, or scripture. Filter by theme, key, slide availability, saved hymns, or four-part harmony.
- Select hymns to inspect notation previews and metadata; save favorites and add hymns to the service.
- Drag service items to reorder, or use the move buttons in the item editor. Edit leaders, durations, and notes.
- Switch among sample services, create a service, duplicate a plan, and edit its theme.
- Preview the service with arrow-key navigation. Export a text outline.
- On mobile, switch between the service order and hymn library. Detailed sheet music is replaced with compact metadata.
- Press `/` to search and `⌘K` / `Ctrl+K` to add an item.

Changes persist in browser localStorage under `gather-prototype-v1`. People, catalog numbers, and slide availability are sample data. All notation is illustrative and is not the actual hymn arrangement. PowerPoint generation, verified slide assets, authentication, cloud collaboration, and native integrations are outside this prototype.

The UI uses no framework or external icon dependency. The presentation layer can serve as a design reference for native desktop and mobile implementations.
