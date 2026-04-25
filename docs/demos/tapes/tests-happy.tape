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

Output tests-happy.gif

# Show the play-bounce scene — the happy bounce triggered by play/test-pass
Type "glyphling capture play-bounce --fps 15 --duration 5"
Enter
Sleep 5500ms
