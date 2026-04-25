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

Output hero-idle.gif

# Seed fresh state
Type "glyphling hatch circuit"
Enter
Sleep 500ms

# Run idle-baseline for 8 seconds — hypnotic loop
Type "glyphling capture idle-baseline --fps 10 --duration 8"
Enter
Sleep 8500ms
