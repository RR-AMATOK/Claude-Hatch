# --- glyphling house style ---
Set Shell "bash"
Set WindowBar ""
Set Margin 0
Set Padding 20
Set Theme "GruvboxDark"
Set FontSize 14
Set TypingSpeed 50ms
Set PlaybackSpeed 1.0
Set Framerate 24
# --- standard tier ---
Set Width 960
Set Height 240

Output xp-flag.gif

# Seed fresh state
Type "glyphling hatch circuit Pixel"
Enter
Sleep 500ms

# Show the compact XP-glyph display — brief levelup-flash compact frames
Type "glyphling capture levelup-flash --fps 24 --duration 2"
Enter
Sleep 2500ms
