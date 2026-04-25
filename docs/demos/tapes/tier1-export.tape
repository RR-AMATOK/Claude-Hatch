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

Output tier1-export.gif

# Seed state at level 25 (12918 XP meets the Tier 1 unlock threshold)
Type "glyphling hatch circuit Pixel --xp 12918"
Enter
Sleep 500ms

# Run the export command — shows the snapshot moment
Type "glyphling export 1"
Enter
Sleep 4000ms
