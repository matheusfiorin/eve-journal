# kotlinx.serialization and OkHttp ship their own consumer rules. QuickJS calls back into its binding classes over JNI.
-keep class com.dokar.quickjs.** { *; }
-dontwarn org.slf4j.**
