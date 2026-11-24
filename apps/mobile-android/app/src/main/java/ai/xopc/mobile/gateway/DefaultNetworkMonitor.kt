package ai.xopc.mobile.gateway

import android.net.ConnectivityManager
import android.net.Network
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

internal fun ConnectivityManager.defaultNetworkChanges(): Flow<Network?> = callbackFlow {
  val callback = object : ConnectivityManager.NetworkCallback() {
    override fun onAvailable(network: Network) { trySend(network) }
    override fun onLost(network: Network) { trySend(null) }
  }
  registerDefaultNetworkCallback(callback)
  trySend(activeNetwork)
  awaitClose { unregisterNetworkCallback(callback) }
}.distinctUntilChanged()
