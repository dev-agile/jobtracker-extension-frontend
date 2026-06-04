# Popup module layout

Source lives in `src/`; `dist/` holds HTML/CSS and the script entry (ES modules, no bundler).

```
popup/
├── dist/
│   ├── index.html      # loads ../src/main.js
│   └── styles.css
└── src/
    ├── main.js           # entry: init + event wiring
    ├── config.js         # constants (statuses, selectors, regexes)
    ├── dom.js            # getElementById refs
    ├── state.js          # allJobs, banner timer
    ├── filters.js        # search/status filter + quick-filter highlight
    ├── api/
    │   └── messaging.js  # chrome.runtime.sendMessage
    ├── utils/
    │   ├── job-fields.js # pick fields, search haystack, company name
    │   ├── dates.js      # posted/applied formatting + sort
    │   └── text.js       # label case, hide junk text, status CSS
    ├── ui/
    │   ├── banner.js
    │   ├── loading.js
    │   ├── counts.js
    │   └── status-pill.js
    ├── render/
    │   ├── quick-filters.js
    │   ├── jobs-list.js    # list + empty state
    │   ├── job-card.js     # one card from template
    │   ├── job-facts.js
    │   ├── job-skills.js
    │   └── status-select.js
    └── actions/
        ├── sync.js
        ├── local.js
        ├── status.js
        └── delete.js
```

**Where to look when debugging**

| Symptom | File |
|--------|------|
| Wrong dates on cards | `utils/dates.js` |
| Search/filter not matching | `filters.js`, `utils/job-fields.js` |
| Card layout / missing fields | `render/job-card.js`, `config.js` |
| Sync / API errors | `actions/sync.js`, `api/messaging.js` |
| Status update fails | `actions/status.js` |
| Delete issues | `actions/delete.js` |

Reload the extension after editing `src/` files (Chrome DevTools shows real file names in the stack trace).
