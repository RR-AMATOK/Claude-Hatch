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

Output level-up.gif

# Seed state at 305 XP (level 4, one XP below the level-5 boundary at 306)
Type "glyphling hatch circuit Pixel --xp 305"
Enter
Sleep 500ms

# Show the levelup-flash animation — the scene that plays on every level.up event
Type "glyphling capture levelup-flash --fps 30 --duration 2"
Enter
Sleep 2500ms
