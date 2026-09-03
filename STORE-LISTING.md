# PageClip Chrome Web Store listing

## Product

- Name: PageClip
- Homepage: https://phishinqi.github.io/PageClip/
- Privacy policy: https://phishinqi.github.io/PageClip/privacy.html
- Terms of service: https://phishinqi.github.io/PageClip/terms.html
- Support: https://github.com/phishinqi/PageClip/issues
- Last Web Store package: release/PageClip-v1.6.8.zip

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

PageClip keeps your browser workflow organized without mixing permanent bookmarks, temporary reading items, quick tab collections, and Chrome native bookmarks into one list. Save pages to a local-first collection, add folders, tags, and notes, preserve quick tab groups, optionally copy new eligible Chrome bookmarks into PageClip automatically, use a 30-day recycle bin, manually or automatically back up the complete PageClip data set to Google Drive after client-side encryption, and browse retained backup history.

Automatic browser-bookmark import is opt-in and additive: PageClip reads Chrome bookmarks, adds only eligible URLs not already in PageClip, and never changes Chrome. Chrome-side deletes, moves, renames, and URL edits do not delete or overwrite PageClip copies. Copied records remain local unless the user later chooses an encrypted export or cloud backup.

PageClip does not modify Chrome bookmarks when importing or restoring PageClip cloud data. Google Drive backups are encrypted before upload, and PageClip does not operate a separate application server, advertising system, or analytics tracker.

## Permission justifications

- bookmarks: read and manage Chrome native bookmarks in the dedicated Chrome Bookmarks view; manual and opt-in automatic browser-bookmark import are additive copy-only operations.
- tabs: read the active tab or current window tab URLs and titles for collection, Inbox, and quick tab collection actions.
- storage: store PageClip data locally in chrome.storage.local.
- favicon: display website favicons.
- contextMenus: expose PageClip actions from the browser context menu.
- tabGroups: preserve Chrome tab group metadata in quick collections.
- scripting: inject the PageClip web sidebar bridge on ordinary http/https pages.
- identity: authenticate the user with Google for an explicitly requested cloud backup or restore.
- identity.email: display the connected Google account in the settings page.
- readingList (optional): only after permission is granted, integrate with Chrome Reading List; PageClip Inbox remains independent.

## Data use

PageClip uses data only to provide the user-requested collection, bookmark, Inbox, Reading List, local storage, and encrypted backup features. Browser bookmarks are read only after the user invokes manual import or enables automatic import; imported copies remain local unless the user separately uses export or encrypted backup. It does not sell data, use data for advertising, creditworthiness, price evaluation, or behavioral profiling.
