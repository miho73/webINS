import {useState} from "react";
import {motion} from "framer-motion";
import {Cable, ChevronsLeftRightEllipsis} from "lucide-react";

import {Button} from "@/components/ui/button";
import type {ConnectionResultCode} from "@/core/Serial.ts";
import serial, {ConnectionResult} from "@/core/Serial.ts";

const checklist = [
    "아두이노와 컴퓨터를 USB 케이블로 연결하세요.",
    "브라우저에서 Web Serial 권한을 승인합니다.",
    "보드가 정상적으로 작동하는지 확인하세요.",
];

const resultMessage: Record<ConnectionResultCode, { label: string; description: string }> = {
    [ConnectionResult.OK]: {
        label: "연결 완료",
        description: "PING 명령에 PONG 응답을 확인했습니다. 장비 정보를 표시합니다.",
    },
    [ConnectionResult.NOT_SUPPORTED]: {
        label: "Web Serial 미지원 브라우저",
        description: "Chrome 브라우저를 사용하고, 버전이 89 이상이여야 합니다.",
    },
    [ConnectionResult.EXCEPTION]: {
        label: "연결 실패",
        description: "장비 선택이 취소되었거나 연결 중 문제가 발생했습니다. 만약 Arduino IDE를 사용중인 경우 이를 끄고 아두이노를 RESET한 후 다시 시도해주세요.",
    },
    [ConnectionResult.PONG_TIMEOUT]: {
        label: "응답 없음",
        description: "PING을 전송했지만 제한 시간 안에 PONG 응답을 받지 못했습니다.",
    },
    [ConnectionResult.WAITING_TIMEOUT]: {
        label: "대기 상태 응답 없음",
        description: "아두이노의 STATUS:WAITING 응답을 제한 시간 내에 받지 못했습니다.",
    },
    [ConnectionResult.OPEN_FAILED]: {
        label: "시리얼 포트 열기 실패",
        description: "포트가 이미 사용 중이거나 브라우저가 포트를 열 수 없습니다. 다른 시리얼 모니터를 닫고 다시 시도하세요.",
    },
};

type ConnectProps = {
    onConnected?(): void;
};

export function Connect({onConnected}: ConnectProps) {
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectionResult, setConnectionResult] = useState<ConnectionResultCode | null>(null);

    async function connect() {
        setIsConnecting(true);

        try {
            const result = await serial.connect();
            setConnectionResult(result);

            if (result === ConnectionResult.OK) {
                console.log("[Serial] Connected successfully.");
                onConnected?.();
            }
        } finally {
            setIsConnecting(false);
        }
    }

    const currentStatus = connectionResult === null
        ? {
            label: "연결 대기",
            description: "아두이노를 연결한 뒤 연결하기 버튼을 눌러주세요.",
        }
        : resultMessage[connectionResult];
    const isErrorResult = connectionResult === ConnectionResult.NOT_SUPPORTED
        || connectionResult === ConnectionResult.EXCEPTION
        || connectionResult === ConnectionResult.PONG_TIMEOUT
        || connectionResult === ConnectionResult.WAITING_TIMEOUT
        || connectionResult === ConnectionResult.OPEN_FAILED;

    return (
        <section className="grid h-full min-h-0 place-items-center">
            <motion.div
                className="w-full max-w-3xl text-center"
                initial={{opacity: 0, y: 16}}
                animate={{opacity: 1, y: 0}}
                transition={{duration: 0.45, ease: "easeOut"}}
            >
                <div
                    className="mx-auto mb-6 flex size-16 items-center justify-center rounded-md border border-white/15 bg-white text-black">
                    <Cable className="size-8"/>
                </div>

                <p className="mb-3 text-sm font-semibold tracking-[0.24em] text-white/45 uppercase">Device
                    connection</p>
                <h1 className="text-4xl font-semibold leading-tight text-white sm:text-5xl">아두이노를 연결합니다.</h1>
                <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-white/60">장비를 컴퓨터에 연결한 뒤 아래 버튼을 눌러 연결을
                    시작하세요.</p>

                <div className="mt-8 flex items-center justify-center">
                    <Button
                        className="h-12 gap-2 bg-white px-6 text-base text-black hover:bg-white/90"
                        disabled={isConnecting}
                        onClick={connect}
                    >
                        {isConnecting ? (
                            <motion.span
                                aria-hidden="true"
                                className="size-5 rounded-full border-2 border-black/25 border-t-black"
                                animate={{rotate: 360}}
                                transition={{duration: 0.8, ease: "linear", repeat: Infinity}}
                            />
                        ) : (
                            <ChevronsLeftRightEllipsis className="size-5"/>
                        )}
                        <span>{isConnecting ? "연결중" : "연결하기"}</span>
                    </Button>
                </div>

                <div
                    className={[
                        "mx-auto mt-6 max-w-xl border px-5 py-4 text-left",
                        isErrorResult
                            ? "border-red-400/50 bg-red-500/10"
                            : "border-white/10 bg-white/3",
                    ].join(" ")}
                >
                    <div className="flex items-center justify-between gap-4">
                        <span
                            className={isErrorResult ? "text-sm font-semibold text-red-100" : "text-sm font-semibold text-white"}>
                            {currentStatus.label}
                        </span>
                        <span
                            className={isErrorResult ? "size-2 rounded-full bg-red-300" : "size-2 rounded-full bg-white"}/>
                    </div>
                    <p className={isErrorResult ? "mt-2 text-sm leading-6 text-red-100/70" : "mt-2 text-sm leading-6 text-white/55"}>
                        {currentStatus.description}
                    </p>
                </div>

                <div className="mt-10 grid gap-3 sm:grid-cols-3">
                    {checklist.map((item, idx) => (
                        <div
                            key={item}
                            className="border border-white/10 bg-white/3 px-4 py-4 text-left"
                        >
                            <p className={"text-lg font-medium"}>{idx + 1}</p>
                            <p className="text-sm font-medium text-white">{item}</p>
                        </div>
                    ))}
                </div>
            </motion.div>
        </section>
    );
}
