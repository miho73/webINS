import type {ReactNode} from "react";
import {motion} from "framer-motion";
import {Gauge, Move3D, TrendingUp} from "lucide-react";

const velocity = [
    ["X", "0.42 m/s"],
    ["Y", "-0.08 m/s"],
    ["Z", "1.16 m/s"],
];

const acceleration = [
    ["X", "0.11 m/s²"],
    ["Y", "0.03 m/s²"],
    ["Z", "0.98 m/s²"],
];

export function VisualizerGraph() {
    return (
        <section className="grid h-full min-h-0 gap-5 lg:grid-cols-[1fr_360px]">
            <motion.div
                className="grid min-h-0 grid-rows-[auto_1fr] border border-white/10 bg-white/3 p-5"
                initial={{opacity: 0, y: 16}}
                animate={{opacity: 1, y: 0}}
                transition={{duration: 0.45, ease: "easeOut"}}
            >
                <div className="mb-5 flex items-center justify-between">
                    <div>
                        <p className="text-sm font-semibold tracking-[0.24em] text-white/45 uppercase">
                            Live graph
                        </p>
                        <h1 className="mt-2 text-3xl font-semibold text-white">시각화 그래프</h1>
                    </div>
                    <TrendingUp className="size-6 text-white/60"/>
                </div>

                <div className="relative min-h-0 border border-white/10 bg-black">
                    <div
                        className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:48px_48px]"/>
                    <div className="absolute inset-x-8 top-1/2 h-px bg-white/25"/>
                    <div className="absolute inset-y-8 left-1/2 w-px bg-white/25"/>
                    <div className="absolute inset-0 grid place-items-center">
                        <div className="border border-white/15 bg-black/70 px-5 py-3 text-sm font-medium text-white/55">
                            Graph placeholder
                        </div>
                    </div>
                </div>
            </motion.div>

            <motion.aside
                className="grid min-h-0 gap-4"
                initial={{opacity: 0, x: 16}}
                animate={{opacity: 1, x: 0}}
                transition={{duration: 0.45, delay: 0.08, ease: "easeOut"}}
            >
                <MetricPanel icon={<Gauge className="size-5"/>} title="실시간 속도" rows={velocity}/>
                <MetricPanel icon={<Move3D className="size-5"/>} title="가속도 측정값" rows={acceleration}/>
            </motion.aside>
        </section>
    );
}

function MetricPanel({
    icon,
    title,
    rows,
}: {
    icon: ReactNode
    title: string
    rows: string[][]
}) {
    return (
        <div className="border border-white/10 bg-white/3 p-5">
            <div className="mb-5 flex items-center gap-3 text-white">
                <div className="flex size-9 items-center justify-center rounded-md bg-white text-black">
                    {icon}
                </div>
                <h2 className="text-lg font-semibold">{title}</h2>
            </div>

            <div className="grid gap-3">
                {rows.map(([axis, value]) => (
                    <div
                        key={axis}
                        className="flex items-center justify-between border border-white/10 bg-black/50 px-4 py-3"
                    >
                        <span className="text-sm text-white/45">{axis} axis</span>
                        <span className="text-xl font-semibold text-white">{value}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
