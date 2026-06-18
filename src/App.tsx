import {useState} from "react";
import {motion} from "framer-motion";
import {Activity, Cable, Sigma} from "lucide-react";

import {Integral} from "@/pages/integral/Integral.tsx";
import {Debug} from "@/pages/debug/Debug.tsx";
import {VisualizerGraph} from "@/pages/visualizer/VisualizerGraph";
import ConnectionIndex from "@/pages/connection/ConnectionIndex.tsx";
import "./style/univ.css";
import * as React from "react";

const tabs = [
    {
        id: "connect",
        label: "연결",
        description: "Web Serial",
        icon: Cable,
    },
    {
        id: "integral",
        label: "적분",
        description: "Integration",
        icon: Sigma,
    },
    {
        id: "visualizer",
        label: "시각화",
        description: "Graph metrics",
        icon: Activity,
    },
];

function App() {
    const [activeTab, setActiveTab] = useState(tabs[0]);
    const [isDebugOpen, setIsDebugOpen] = useState(false);

    function openDebugPage(event: React.MouseEvent<HTMLDivElement>) {
        if (event.button !== 1 && event.button !== 2) {
            return;
        }

        event.preventDefault();

        if (window.prompt("Type \"debug\" to enter debug mode") === "debug") {
            setIsDebugOpen(true);
        }
    }

    function renderActivePage() {
        if (isDebugOpen) {
            return <Debug/>;
        }

        if (activeTab.id === "connect") {
            return <ConnectionIndex/>;
        }

        if (activeTab.id === "visualizer") {
            return <VisualizerGraph/>;
        }

        return <Integral/>;
    }

    return (
        <main
            className={[
                "relative h-svh bg-black text-white",
                isDebugOpen ? "overflow-y-auto" : "overflow-hidden",
            ].join(" ")}
        >
            <motion.div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.12),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_34%)]"
                initial={{opacity: 0}}
                animate={{opacity: 1}}
                transition={{duration: 0.8, ease: "easeOut"}}
            />
            <div
                className={[
                    "relative mx-auto grid max-w-7xl grid-rows-[auto_auto_1fr] gap-5 px-6 py-5 sm:px-8 lg:px-12",
                    isDebugOpen ? "min-h-full" : "h-full",
                ].join(" ")}
            >
                <header className="flex items-center justify-between border-b border-white/10 pb-5">
                    <motion.div
                        className="flex items-center"
                        initial={{opacity: 0, y: -10}}
                        animate={{opacity: 1, y: 0}}
                        transition={{duration: 0.45, ease: "easeOut"}}
                    >
                        <span className="text-3xl font-semibold tracking-[0.16em] text-white">
                            webINS
                        </span>
                    </motion.div>

                    <div
                        className="border border-white bg-white px-3 py-1.5 text-black"
                        onAuxClick={openDebugPage}
                        onContextMenu={openDebugPage}
                    >
                        <span className="text-xs font-bold tracking-[0.14em]">
                            FOR EDUCATIONAL PURPOSE ONLY
                        </span>
                    </div>
                </header>

                <nav className="grid grid-cols-3 gap-2" aria-label="페이지 탭">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = tab.id === activeTab.id;

                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => {
                                    setIsDebugOpen(false);
                                    setActiveTab(tab);
                                }}
                                className={[
                                    "flex min-h-16 items-center gap-3 border px-4 text-left",
                                    isActive && !isDebugOpen
                                        ? "border-white bg-white text-black"
                                        : "border-white/10 bg-white/3 text-white hover:bg-white/6",
                                ].join(" ")}
                            >
                                <Icon className="size-5 shrink-0"/>
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold">{tab.label}</span>
                                    <span
                                        className={[
                                            "mt-1 block truncate text-xs",
                                            isActive && !isDebugOpen ? "text-black/55" : "text-white/40",
                                        ].join(" ")}
                                    >
                                        {tab.description}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </nav>

                <motion.div
                    key={isDebugOpen ? "debug" : activeTab.id}
                    className="min-h-0"
                    initial={{opacity: 0, y: 10}}
                    animate={{opacity: 1, y: 0}}
                    transition={{duration: 0.28, ease: "easeOut"}}
                >
                    {renderActivePage()}
                </motion.div>
            </div>
        </main>
    );
}

export default App;
