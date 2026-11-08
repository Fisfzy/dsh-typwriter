---
nav: Installation
description: Install Texpile on Windows, macOS, or Linux, then a TeX distribution for LaTeX, tinymist for Typst, and git for version control.
blurb: Install Texpile, then a compiler for the format you write in.
icon: hard-drive-download
order: 1
pager: skip-children
section: Get started
---

# Installation

You will need to 1. install Texpile and 2. install your typesetter (LaTeX, Typst, etc.), and optionally (but heavily recommended) git.

If you have already installed Texpile, go directly to the typesetter installation guides here:

- LaTeX: [a TeX distribution](latex/README.md).
- Typst: [tinymist](typst/README.md).
- Source Control: [git](git.md).

## 1. Install Texpile

Visit the [downloads page](/download) for the installer for your platform:

- **Windows:** After downloading, double-click the file to install.
- **Windows Portable:** We do not recommend using Windows Portable over the Windows installer since it does not have auto update and may have certain features disabled. After downloading the zip, extract it and click Texpile.exe.
- **macOS:** Open the .dmg and drag Texpile to Applications.
- **Debian and Ubuntu:** Install the .deb with apt using `sudo apt install ./texpile.deb`.
- **Other Linux:** Download the AppImage build and run `chmod +x Texpile.AppImage`, then double-click the AppImage to start it.

### Install with the command line (Linux)

Debian-based distros:

```bash
wget https://dl.texpile.com/latest/deb -O texpile.deb
sudo apt install ./texpile.deb
```

Other Linux distributions use the AppImage:

```bash
wget https://dl.texpile.com/latest/linux -O Texpile.AppImage
chmod +x Texpile.AppImage
./Texpile.AppImage
```

Some distros will require you to manually install FUSE 2. We heavily recommend you refer to your distro for FUSE 2 installation guides. The following are provided for Debian-based systems:

```bash
sudo apt install libfuse2t64
```

Or, for older Debian systems:

```bash
sudo apt install libfuse2
```

## 2. Install what you need

- LaTeX: [a TeX distribution](latex/README.md).
- Typst: [tinymist](typst/README.md).
- Source Control: [git](git.md).
