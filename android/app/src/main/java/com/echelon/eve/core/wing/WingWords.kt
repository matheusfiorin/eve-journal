package com.echelon.eve.core.wing

// The words the wing uses for its protocol values, shared by the screen, the notifications and the push text.

/** "mining", "exploring", "PvP": the activity inside a sentence. */
fun activityWord(activity: String): String = when (activity) {
    WingStatus.PVP -> "PvP"; else -> activity
}

/** The activity as a label: "Mining", "PvP". */
fun activityLabel(activity: String): String = when (activity) {
    WingStatus.PVP -> "PvP"; else -> activity.replaceFirstChar { it.uppercase() }
}

/** An answer in plain words: "Seen", "On it", "Can’t". */
fun ackWord(kind: String): String = when (kind) { WingAck.SEEN -> "Seen"; WingAck.ONIT -> "On it"; WingAck.CANT -> "Can’t make it"; else -> kind }

/** "a mining", "an exploring": the article before a word. */
fun aOrAn(word: String): String = (if (word.firstOrNull()?.lowercaseChar() in setOf('a', 'e', 'i', 'o', 'u')) "an " else "a ") + word
