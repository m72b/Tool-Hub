# Tool Hub add-ons

Every tool in Tool Hub belongs to a section, and each section is an add-on you can download, update or remove on its own. To install or build add-ons, see the [add-on guide](ADDONS.md).

Tool Hub comes with the Starter Tools. Everything else is a section you add from the Tool Library:

| Section | Size | Tools |
|---|---|---|
| **Starter Tools** (included) | 18 KB | Batch Renamer · File Organizer · Text & Data Utilities (JSON, Base64, UUID, text diff, regex, passwords) |
| **File Tools** | 26 KB | Folder Compare · File Hash Generator · File Attribute Editor · File Date Editor · Directory Tree Export · Folder Sync · File Type Fixer · Archive Tool · Watch Folder · Workflows |
| **Cleanup Tools** | 21 KB | Duplicate Finder · Disk Space Analyzer · Large File Finder · Temporary File Cleaner · Empty Folder Cleaner · Zero-Byte & Shortcut Finder · Secure Delete · Scheduled Cleanup¹ |
| **System Tools** | 22 KB | Installed Apps Manager¹ · Startup Manager¹ · System Information · Drive Health¹ · Network Toolkit · Port & Process Viewer · Hosts & Environment Editor¹ · File Lock Finder¹ · Disk Benchmark |
| **Media Tools** | 8 KB | Image Converter · Image Resizer · Image Privacy & Watermark |
| [**PDF Tools**](#pdf-tools) | 5.4 MB | See below |
| [**Clipboard Manager**](#clipboard-manager) | 12 KB | See below |
| [**Screenshot & Capture**](#screenshot--capture) | 15 KB | See below |
| [**Font Manager**](#font-manager) | 10 KB | See below |
| [**Event Log Analyzer**](#event-log-analyzer)¹ | 10 KB | See below |
| [**Device Manager**](#device-manager)¹ | 7 KB | See below |

¹ Windows only. These tools are hidden on other platforms.

## Clipboard Manager

A searchable history of the text, images and file references you copy, with pinned entries, favorites, collections and configurable retention. It is built to be careful with what it sees:

- Nothing is recorded until you start monitoring, and only while Tool Hub is open.
- The history stays on your PC, encrypted with your Windows, macOS or Linux login. If a system has no secure storage, the tool warns you that the history is not encrypted. Removing the section deletes it.
- Copies that password managers mark as private are skipped, and you choose which apps are never recorded. Common password managers are on that list from the start.

On Linux, the app list needs `xdotool`, and it does not work under Wayland. The tool tells you when it cannot apply the list.

## Screenshot & Capture

- **Capture** a region, a window or a full screen, with an optional delay. Tool Hub hides itself while capturing.
- **Scrolling capture:** select an area, scroll it slowly yourself, and press **Done**. The frames are joined into one image, and sticky headers and footers appear only once.
- **Edit** with arrows, boxes, a pen, highlights, text and blur. Edits are saved as a new copy, so the original stays as it was.
- **Extract text** with Windows' built-in text recognition, or [Tesseract](https://github.com/tesseract-ocr/tesseract) on macOS and Linux.
- **History:** copy or export captures as PNG or JPG. Captures are stored on your PC without encryption, and removing the section deletes them.

## Font Manager

- **Preview** your own text at any size, and **compare** up to six families side by side.
- **Install** TTF, OTF and TTC fonts for your user account, with no administrator rights needed.
- **Remove** fonts you installed. They go to the Recycle Bin. Fonts that came with the system are protected, because removing one can break apps.
- **Inspect** a font's version, maker, weight, glyph count, embedding rights and license, and **find duplicates**: identical files, and different files sharing one font name.

## Event Log Analyzer

- **Browse** every Windows event log, and filter by level, time, source, event ID and text.
- **Recurring problems:** repeats of one error are grouped, even when their numbers and IDs differ.
- **Error bursts:** errors close together in time are grouped, and any event can show what happened in the main logs around that moment.
- **Reports** export as HTML, CSV or JSON.

Windows only lets administrators read the Security log, so run Tool Hub as administrator to open it.

## Device Manager

- **USB inventory** with maker, class, vendor and product IDs, and serial numbers.
- **All hardware** on the PC, filtered by class, with a marker for devices reporting a problem.
- **Connection history** of USB devices Windows remembers, with the last time each was connected.
- **Driver details:** version, date, provider, file and signature.
- **Safely remove** USB drives. Windows refuses if files on the drive are in use, and the tool says so.

## PDF Tools

28 PDF tools in one section:

| Group | Tools |
|---|---|
| **Organize** | Merge · Split · Organize pages · Rotate |
| **Optimize** | Compress · Repair · OCR · PDF to PDF/A |
| **Convert** | PDF to Word · PowerPoint · Excel · JPG · Markdown — and Word · PowerPoint · Excel · JPG · HTML to PDF |
| **Edit** | Edit PDF · Watermark · Page numbers · Crop · PDF Forms |
| **Security** | Protect · Unlock · Sign · Redact |
| **Intelligence** | Compare PDF |

Office-to-PDF conversion uses Microsoft Office or [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/) when either is installed. OCR uses Windows' built-in text recognition, or [Tesseract](https://github.com/tesseract-ocr/tesseract) on macOS and Linux.
