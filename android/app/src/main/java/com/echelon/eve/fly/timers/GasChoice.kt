package com.echelon.eve.fly.timers

import android.content.Context

/** Which gas a new gas timer starts with: the last one used. */
interface GasChoice {
    fun get(): Fullerite
    fun set(gas: Fullerite)

    class Memory(private var gas: Fullerite = DEFAULT) : GasChoice {
        override fun get() = gas
        override fun set(gas: Fullerite) { this.gas = gas }
    }

    /** Kept in the app's own SharedPreferences. */
    class Shared(context: Context) : GasChoice {
        private val sp = context.getSharedPreferences("gas", Context.MODE_PRIVATE)
        override fun get() = Fullerite.of(sp.getLong("last", 0)) ?: DEFAULT
        override fun set(gas: Fullerite) { if (get() != gas) sp.edit().putLong("last", gas.typeId).apply() }
    }

    companion object {
        /** The wormhole sites' most common gas, until the pilot has picked one. */
        val DEFAULT = Fullerite.C320
    }
}
