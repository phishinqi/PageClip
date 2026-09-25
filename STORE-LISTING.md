# PageClip Chrome Web Store listing

## Product

- Name: PageClip
- Homepage: https://phishinqi.github.io/PageClip/
- Privacy policy: https://phishinqi.github.io/PageClip/privacy.html
- Terms of service: https://phishinqi.github.io/PageClip/terms.html
- Support: https://github.com/phishinqi/PageClip/issues
- Last Web Store package: release/PageClip-v1.7.2.zip

## 1.7.2 release notes

- Settings cards now use a consistent full-width, single-column layout. The eight overview statistics form four columns on desktop and two on narrow screens.
- Fixed a script parsing error that left Settings blank below its heading, and restored missing Chinese and English settings labels.
- Added settings-page syntax and translation regression coverage and explicit ES-module validation before packaging.

## 1.7.1 release notes

- Settings now uses a compact workspace with category navigation and search, plus an About section with version, project, privacy, and permission information.
- Domain tag rules can independently match only the configured host or include all subdomains; existing rules keep their previous subdomain behavior.

## 1.7.0 release notes

- Batch tag editing for PageClip collections and Chrome bookmarks: open one editor from the selection toolbar, the multi-selection context menu, or a folder context menu to add, remove, fill, or replace tags. Each bookmark keeps at most 12 tags, and every batch edit can be undone.
- Search results can be multi-selected (Ctrl to toggle, Shift for a range, or Select all) and tagged in one batch across collections and Chrome bookmarks. Chrome bookmark search results are no longer capped at 50.
- Chrome bookmarks can now carry tags. Tags are stored in PageClip data and shared by URL with PageClip collections; PageClip never writes them into Chrome bookmarks. Searching `#tag` now filters both collections and Chrome bookmarks.
- Global tag management in Settings and from the tag strip context menu: rename, merge, or delete a tag everywhere after a confirmation, with undo. Matching tags inside rules are updated too.
- Optional tagging rules by domain (including subdomains), title or URL keyword, and nearest folder name. Rules run for new bookmarks and can be applied to existing bookmarks on demand; they only add tags and never remove them.
- Fixed dropping a multi-selection onto a folder so every selected item moves, made toast Undo buttons clickable, and stopped clicks on the tag field label from removing the first tag.

## 1.6.11 release notes

- Automatic Google Drive backups now pause gracefully when Google requires a visible reauthorization, then send one notification that opens Settings for an explicit reconnect.
- Brave can reuse a valid short-lived local Web OAuth Access Token after a service-worker restart; PageClip never stores a Google Refresh Token or OAuth client secret.

## 1.6.10 release notes

- Automatic Google Drive backup is opt-in and runs once about 10 seconds after PageClip data changes; closely spaced edits are combined into one encrypted backup.
- The Chrome bookmark automatic-import toggle now strictly stops or starts background reconciliation, including delete events without deleting PageClip copies.

## 1.6.9 release notes

- Added opt-in automatic Chrome bookmark import. It copies new eligible Chrome bookmarks into PageClip without modifying Chrome or deleting/overwriting PageClip copies.
- Coalesced bookmark-change bursts and added recovery scheduling so large Chrome bookmark updates import safely.
- Serialized PageClip storage mutations across extension contexts to protect concurrent saves.

## 1.6.8 release notes

- Fixed truncation when expanding long Chrome bookmark folders; large folders now load additional direct children automatically while scrolling.
- Prevented duplicate Brave Web OAuth authorization flows when an authorization request is already in progress.

## 1.6.7 release notes

- Switched to the new Chrome Extension OAuth client and synchronized the fixed Extension ID.

## 1.6.6 release notes

- Updated the Chrome Extension OAuth client configuration for Google Drive authorization.

## 1.6.5 hotfix release notes

- Fixed a crash when opening or editing collection items with existing or newly added tags.
- Preserved tag entry with Enter, English comma, and Chinese comma, plus duplicate prevention and the 12-tag limit.

## 1.6.4 release notes

- Fixed recursive folder counts and parent-folder browsing for nested collections.
- Unified folder row click and Space-key expand/collapse behavior across collection and Chrome bookmark trees.
- Renamed Custom ordering to Manual order and fixed collection item editing/tag chips.
- Fixed folder count alignment and made the folder rail width drag smoother.
- Virtualized large collection lists so folders with around 1,400 saved pages remain responsive.

## Short description

中文：本地优先的 Chrome 侧边栏收藏、快捷收藏夹、Inbox 与加密 Google Drive 备份工具。

English: A local-first Chrome sidebar for bookmarks, quick access, Inbox, and encrypted Google Drive backups。

## Detailed description

PageClip keeps your browser workflow organized without mixing permanent bookmarks, temporary reading items, quick tab collections, and Chrome native bookmarks into one list. Save pages to a local-first collection, add folders, tags, and notes, preserve quick tab groups, optionally copy new eligible Chrome bookmarks into PageClip automatically, use a 30-day recycle bin, manually or—when enabled—after PageClip data changes automatically back up the complete PageClip data set to Google Drive after client-side encryption, and browse retained backup history.

Automatic browser-bookmark import is opt-in and additive: PageClip reads Chrome bookmarks, adds only eligible URLs not already in PageClip, and never changes Chrome. Chrome-side deletes, moves, renames, and URL edits do not delete or overwrite PageClip copies. Copied records remain local unless the user later chooses an encrypted export, manual cloud backup, or enables automatic cloud backup and PageClip data changes.

Tags can be batch-edited across PageClip collections and Chrome bookmarks. Tags on Chrome bookmarks are stored only in PageClip data, keyed by URL, and are never written into Chrome bookmarks. Optional tagging rules run locally and only add tags.

PageClip does not modify Chrome bookmarks when importing or restoring PageClip cloud data. Google Drive backups are encrypted before upload, and PageClip does not operate a separate application server, advertising system, or analytics tracker.

## Permission justifications

- bookmarks: read and manage Chrome native bookmarks in the dedicated Chrome Bookmarks view; manual and opt-in automatic browser-bookmark import are additive copy-only operations; optional user-defined tagging rules read the title, URL, and folder name of new bookmarks to add PageClip tags.
- tabs: read the active tab or current window tab URLs and titles for collection, Inbox, and quick tab collection actions.
- storage: store PageClip data locally in chrome.storage.local.
- favicon: display website favicons.
- contextMenus: expose PageClip actions from the browser context menu.
- tabGroups: preserve Chrome tab group metadata in quick collections.
- scripting: inject the PageClip web sidebar bridge on ordinary http/https pages.
- identity: authenticate the user with Google for an explicitly requested cloud backup or restore.
- identity.email: display the connected Google account in the settings page.
- notifications: send one actionable system notification only when an enabled automatic Google Drive backup is paused because Google requires visible reauthorization. Clicking it opens PageClip Settings, where the user explicitly chooses whether to reconnect Google Drive. PageClip does not use notifications for advertising, recurring reminders, tracking, or unrelated messages.
- readingList (optional): only after permission is granted, integrate with Chrome Reading List; PageClip Inbox remains independent.

## Data use

PageClip uses data only to provide the user-requested collection, bookmark, Inbox, Reading List, local storage, and encrypted backup features. Browser bookmarks are read only after the user invokes manual import or enables automatic import; imported copies remain local unless the user separately uses export or encrypted backup. It does not sell data, use data for advertising, creditworthiness, price evaluation, or behavioral profiling.
