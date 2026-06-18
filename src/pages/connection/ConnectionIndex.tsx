import {useState} from "react";

import serial, {ConnectionStatus} from "@/core/Serial.ts";
import {Connected} from "@/pages/connection/Connected.tsx";
import {Connect} from "@/pages/connection/Connect.tsx";


function Connection() {
    const [, setRefreshKey] = useState(0);

    function refreshConnectionStatus() {
        setRefreshKey((key) => key + 1);
    }

    if (serial.connectionStatus === ConnectionStatus.ONLINE)
        return <Connected onDisconnected={refreshConnectionStatus}/>;
    else
        return <Connect onConnected={refreshConnectionStatus}/>;
}

export default Connection;
