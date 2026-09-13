# Audiobook Workbench
Want to support the project? Find me on [Patreon](https://patreon.com/Bageena?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink)
> **Status: Work in Progress**
>
> Audiobook Workbench is still under active development, testing, and refinement. It is not currently recommended for general installation or production use.

## Overview

**Audiobook Workbench** is an open-source, local web application for preparing, organizing, and preserving audiobooks.

Built with **Node.js**, it provides a browser-based interface while performing file processing locally on your own computer. It is intended primarily for Windows, though it may also be possible to run it in a Docker container depending on the configuration and installation files included with the project.

Audiobook Workbench began as a collection of practical Windows batch-file workflows for audiobook conversion, merging, chaptering, and metadata work. Those batch files became the functional foundation of the project. With assistance from Gemini, the original workflows were translated and expanded into a Node.js web application with a browser-based interface.

Original source audio files are never intentionally modified, and the application does not automatically delete files.

## Features

- Merge multiple audio files into a single M4B audiobook
- Optionally decode source files to PCM before processing
- Bypass PCM decoding when direct processing is preferred
- Use WhisperX AI to identify likely spoken chapter headings and propose chapter timestamps
- Skip AI chapter detection when input files are already chapterized
- Review, add, remove, rename, and fine-tune chapter markers in a browser-based interface
- Edit audiobook metadata, including title, author, narrator, cover art, and other supported fields
- Download YouTube audio in MP3 format and process it through the same workflow
- Preserve original audio files; the app is designed not to overwrite, alter, or automatically delete them
- Run locally as a Node.js web app
- Potentially run in Docker for users who prefer a containerized environment
- Open-source code available for inspection, learning, testing, and improvement

## Development Note

Audiobook Workbench is not a professionally engineered commercial application. It is a personal project built through experimentation, iterative testing, trial and error, and a considerable amount of AI-assisted development.

The project is, frankly, heavily “vibe coded.”

The core functionality began as a set of Windows batch files developed for personal audiobook-processing workflows. Gemini was used to help turn those batch-file processes into a Node.js web application and to expand them into a browser-based interface.

That does not mean the project is unsafe or unusable, but it does mean there may be rough edges, unexpected bugs, incomplete error handling, environment-specific assumptions, and features that have not been tested across every possible configuration.

The code is fully open source. Please feel free to inspect it, learn from it, report problems, suggest improvements, or contribute fixes.

If you choose to test the application, use copies of your files and verify the resulting audiobook before relying on it for a large, valuable, or irreplaceable collection.

## How It Works

Audiobook Workbench is intended to run locally rather than as a public cloud service.

You start the application on your computer, then access its interface through a web browser. The browser provides the GUI, while the actual file processing takes place on your local system.

The application is primarily intended for Windows because its original workflows were based on `.bat` files.

Docker compatibility may be possible, but should be considered experimental unless this repository includes maintained Docker configuration files and installation documentation.

A Docker setup will generally need persistent mounted folders for:

- Source audio files
- Temporary working files, including PCM conversions and AI-analysis data
- Completed M4B output files
- Cover images, metadata, and chapter data
- WhisperX model files, caches, and other required runtime dependencies

## File Safety

Audiobook Workbench is designed with preservation in mind.

- Source audio files should not be altered
- Original files should not be overwritten
- Nothing should be deleted automatically
- Output and working files should be created separately from source files

Even so, this is work-in-progress software. Always maintain backups and test the application with copies of your files before using it on an important collection.

## Windows Security Notice

Because Audiobook Workbench is not distributed by a registered Windows trusted publisher, Windows SmartScreen may show a security warning when you run downloaded batch files, scripts, or executables.

This does not automatically mean that the project is harmful. However, you should only download and run the application from a source you trust. If possible, inspect the included scripts and source code before running them.

### Removing the Windows Download Block

Before extracting a downloaded `.zip` or `.rar` archive:

1. Right-click the downloaded archive.
2. Select **Properties**.
3. On the **General** tab, look for the security section near the bottom of the window.
4. Check the **Unblock** box, if it appears.
5. Click **Apply**, then **OK**.
6. Extract the archive normally.

Unblocking the archive before extraction can prevent Windows from applying its “downloaded from the internet” security marker to the extracted files, which may reduce warning prompts when launching included scripts.

## Intended Use

Audiobook Workbench is intended for lawful personal audiobook organization, preservation, conversion, metadata editing, and chaptering of audio that you own or are authorized to process.

If you use YouTube downloads or other online sources, you are responsible for ensuring that your use complies with applicable copyright law, platform terms, and the rights of authors, narrators, publishers, musicians, and other creators.

## Contributing

This is an evolving personal project, and feedback is welcome.

If you find a bug, have an idea for a feature, discover a compatibility issue, or would like to improve the code, please consider opening an issue or submitting a pull request.
