# Clipboard Indicator

![screenshot_5721](https://user-images.githubusercontent.com/30718505/227160124-3615b183-c554-404e-ba8a-113f904bc5e2.png)

A minimalist Clipboard management extension for the Gnome Shell.

It allows you to:

- VIEW copied items history (default last 15)
- SELECT items and set as current clipboard content (Click on item)
- DELETE items from history (X button)
- CLEAR items history (Clear button)

Clipboard history is stored in .cache folder.

When items history is greater than 15 it auto pop items also from cache. 

It hides completely when the Clipboard is empty.

# Classic Installation
Install the extension from the official gnome extension page:
- https://extensions.gnome.org/extension/5721/clipboard-indicator/

# Manual Installation
Clone the repository to ~/.local/share/gnome-shell/extensions/ and restart the shell:

    git clone https://github.com/Dieg0Js/gnome-clipboard-indicator.git ~/.local/share/gnome-shell/extensions/clipboard-indicator@Dieg0Js.github.io

Fork of Clipman from popov895
 * https://github.com/popov895/Clipman
