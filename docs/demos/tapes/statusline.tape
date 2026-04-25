# --- glyphling house style ---
Set Shell "bash"
Set WindowBar ""
Set Margin 0
Set Padding 10
Set Theme "GruvboxDark"
Set FontSize 14
Set TypingSpeed 50ms
Set PlaybackSpeed 1.0
Set Framerate 24
# --- statusline tier (HUD + 2 silhouette rows + prompt = ~4 rows) ---
Set Width 960
Set Height 120

Output statusline.gif

# Seed fresh state, then render the compact one-line statusline once.
# `clear` first so the terminal scrollback doesn't push the line off-screen.
Type "glyphling hatch circuit Pixel"
Enter
Sleep 400ms
Type "clear && glyphling statusline"
Enter
Sleep 4000ms
