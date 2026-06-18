import {useEffect, useRef} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";

type Vector3Value = {
    x: number;
    y: number;
    z: number;
};

type SensorSceneProps = {
    linearAcceleration: Vector3Value;
    orientationAngles: Vector3Value;
};

type AxisKey = "x" | "y" | "z";

type RotationalArrow = {
    group: THREE.Group;
    line: THREE.Line;
    head: THREE.Mesh;
};

const AXES = [
    {key: "x", color: 0xff4058, direction: new THREE.Vector3(1, 0, 0), label: "X"},
    {key: "y", color: 0x7ee05a, direction: new THREE.Vector3(0, 1, 0), label: "Y"},
    {key: "z", color: 0x4a93ff, direction: new THREE.Vector3(0, 0, 1), label: "Z"},
] as const;

export function SensorScene({linearAcceleration, orientationAngles}: SensorSceneProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const sensorFrameRef = useRef<THREE.Group | null>(null);
    const linearArrowRefs = useRef<THREE.ArrowHelper[]>([]);
    const resultantArrowRef = useRef<THREE.ArrowHelper | null>(null);
    const rotationalArrowRefs = useRef<RotationalArrow[]>([]);
    const textSpriteRefs = useRef<THREE.Sprite[]>([]);
    const orientationQuaternionRef = useRef(new THREE.Quaternion());

    useEffect(() => {
        const container = containerRef.current;

        if (!container) {
            return;
        }

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050505);

        const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        camera.up.set(0, 0, 1);
        camera.position.set(4.8, -5.4, 3.4);

        const renderer = new THREE.WebGLRenderer({antialias: true});
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(container.clientWidth, container.clientHeight);
        container.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 3;
        controls.maxDistance = 10;

        scene.add(new THREE.AmbientLight(0xffffff, 1.6));

        const light = new THREE.DirectionalLight(0xffffff, 2.2);
        light.position.set(4, 6, 5);
        scene.add(light);

        const grid = new THREE.GridHelper(8, 16, 0x333333, 0x202020);
        grid.rotation.x = Math.PI / 2;
        grid.position.z = -1.2;
        scene.add(grid);

        const sensorFrame = new THREE.Group();
        scene.add(sensorFrame);
        sensorFrameRef.current = sensorFrame;

        const sensor = new THREE.Mesh(
            new THREE.SphereGeometry(0.42, 48, 32),
            new THREE.MeshStandardMaterial({
                color: 0x9a9a9a,
                metalness: 0.15,
                roughness: 0.42,
            }),
        );
        sensorFrame.add(sensor);

        const equator = new THREE.Mesh(
            new THREE.TorusGeometry(0.58, 0.01, 12, 96),
            new THREE.MeshBasicMaterial({color: 0xffffff, transparent: true, opacity: 0.55}),
        );
        sensorFrame.add(equator);

        AXES.forEach((axis) => {
            const axisArrow = new THREE.ArrowHelper(axis.direction, new THREE.Vector3(0, 0, 0), 2.1, axis.color, 0.22, 0.1);
            sensorFrame.add(axisArrow);

            const label = createTextSprite(axis.label, `#${axis.color.toString(16).padStart(6, "0")}`);
            label.position.copy(axis.direction.clone().multiplyScalar(2.45));
            sensorFrame.add(label);
            textSpriteRefs.current.push(label);

            const linearArrow = new THREE.ArrowHelper(axis.direction, new THREE.Vector3(0, 0, 0), 0.55, axis.color, 0.18, 0.08);
            sensorFrame.add(linearArrow);
            linearArrowRefs.current.push(linearArrow);
        });

        AXES.forEach((axis) => {
            const ring = createAxisRing(axis.color, axis.key);
            sensorFrame.add(ring);

            const arrow = createRotationalArrow(axis.color, axis.key);
            sensorFrame.add(arrow.group);
            rotationalArrowRefs.current.push(arrow);
        });

        const resultantArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 0.4, 0xffffff, 0.22, 0.1);
        scene.add(resultantArrow);
        resultantArrowRef.current = resultantArrow;

        const resizeObserver = new ResizeObserver(() => {
            const width = Math.max(container.clientWidth, 1);
            const height = Math.max(container.clientHeight, 1);

            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        });

        resizeObserver.observe(container);

        let frameId = 0;

        function render() {
            controls.update();
            renderer.render(scene, camera);
            frameId = window.requestAnimationFrame(render);
        }

        render();

        return () => {
            window.cancelAnimationFrame(frameId);
            resizeObserver.disconnect();
            controls.dispose();
            renderer.dispose();
            container.removeChild(renderer.domElement);
            sensorFrameRef.current = null;
            linearArrowRefs.current = [];
            resultantArrowRef.current = null;
            rotationalArrowRefs.current = [];
            textSpriteRefs.current = [];
        };
    }, []);

    useEffect(() => {
        const vectors = [
            linearAcceleration.x,
            linearAcceleration.y,
            linearAcceleration.z,
        ];

        linearArrowRefs.current.forEach((arrow, index) => {
            const axis = AXES[index];
            const value = vectors[index];
            const magnitude = Math.min(Math.abs(value) * 0.18 + 0.35, 1.8);
            const direction = axis.direction.clone().multiplyScalar(value < 0 ? -1 : 1);

            arrow.setDirection(direction);
            arrow.setLength(magnitude, 0.18, 0.08);
        });

        updateResultantArrow(resultantArrowRef.current, linearAcceleration, orientationQuaternionRef.current);
    }, [linearAcceleration]);

    useEffect(() => {
        const quaternion = createOrientationQuaternion(orientationAngles);

        orientationQuaternionRef.current.copy(quaternion);
        sensorFrameRef.current?.quaternion.copy(quaternion);
        updateResultantArrow(resultantArrowRef.current, linearAcceleration, quaternion);
    }, [orientationAngles, linearAcceleration]);

    useEffect(() => {
        const values = [
            orientationAngles.x,
            orientationAngles.y,
            orientationAngles.z,
        ];

        rotationalArrowRefs.current.forEach((arrow, index) => {
            updateRotationalArrow(arrow, values[index]);
        });
    }, [orientationAngles]);

    return <div ref={containerRef} className="h-full min-h-[340px] w-full touch-none"/>;
}

function createAxisRing(color: number, axis: AxisKey) {
    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.86, 0.006, 8, 96),
        new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.22}),
    );

    orientToAxis(ring, axis);

    return ring;
}

function createRotationalArrow(color: number, axis: AxisKey): RotationalArrow {
    const group = new THREE.Group();
    const geometry = new THREE.BufferGeometry().setFromPoints(createArcPoints(0.86, Math.PI * 0.25, Math.PI * 0.35));
    const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({color, transparent: true, opacity: 0.85}),
    );
    const head = new THREE.Mesh(
        new THREE.ConeGeometry(0.055, 0.16, 16),
        new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.95}),
    );

    group.add(line);
    group.add(head);
    orientToAxis(group, axis);
    updateRotationalArrow({group, line, head}, 0);

    return {group, line, head};
}

function updateRotationalArrow(arrow: RotationalArrow, value: number) {
    const magnitude = Math.abs(value);
    const isVisible = magnitude > 0.001;
    const radius = 0.86;
    const signedDirection = value < 0 ? -1 : 1;
    const arcLength = THREE.MathUtils.clamp(magnitude * 0.09 + Math.PI * 0.22, Math.PI * 0.22, Math.PI * 1.35);
    const start = -arcLength / 2;
    const end = start + arcLength * signedDirection;
    const points = createArcPoints(radius, start, end);
    const endPoint = points[points.length - 1];
    const beforeEndPoint = points[points.length - 2] ?? endPoint.clone().add(new THREE.Vector3(0.01, 0, 0));
    const tangent = endPoint.clone().sub(beforeEndPoint).normalize();
    const opacity = THREE.MathUtils.clamp(magnitude * 0.08 + 0.45, 0.45, 1);

    arrow.line.geometry.dispose();
    arrow.line.geometry = new THREE.BufferGeometry().setFromPoints(points);
    arrow.head.position.copy(endPoint);
    arrow.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    arrow.line.visible = isVisible;
    arrow.head.visible = isVisible;

    if (arrow.line.material instanceof THREE.LineBasicMaterial) {
        arrow.line.material.opacity = opacity;
    }

    if (arrow.head.material instanceof THREE.MeshBasicMaterial) {
        arrow.head.material.opacity = opacity;
    }
}

function createArcPoints(radius: number, start: number, end: number) {
    const points: THREE.Vector3[] = [];

    for (let index = 0; index <= 80; index++) {
        const t = start + (end - start) * (index / 80);
        points.push(new THREE.Vector3(Math.cos(t) * radius, Math.sin(t) * radius, 0));
    }

    return points;
}

function orientToAxis(object: THREE.Object3D, axis: AxisKey) {
    if (axis === "x") {
        object.rotation.y = Math.PI / 2;
    }

    if (axis === "y") {
        object.rotation.x = -Math.PI / 2;
    }
}

function createOrientationQuaternion(angles: Vector3Value) {
    return new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
            THREE.MathUtils.degToRad(angles.x),
            THREE.MathUtils.degToRad(angles.y),
            THREE.MathUtils.degToRad(angles.z),
            "XYZ",
        ),
    );
}

function updateResultantArrow(arrow: THREE.ArrowHelper | null, acceleration: Vector3Value, orientation: THREE.Quaternion) {
    if (!arrow) {
        return;
    }

    const localVector = new THREE.Vector3(acceleration.x, acceleration.y, acceleration.z);
    const worldVector = localVector.applyQuaternion(orientation);
    const magnitude = worldVector.length();

    if (magnitude < 0.001) {
        arrow.visible = false;
        return;
    }

    const direction = worldVector.normalize();
    const length = Math.min(magnitude * 0.18 + 0.45, 2.25);

    arrow.visible = true;
    arrow.setDirection(direction);
    arrow.setLength(length, 0.22, 0.1);
}

function createTextSprite(text: string, color: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");

    if (context) {
        context.fillStyle = "rgba(0, 0, 0, 0.7)";
        context.fillRect(18, 18, 60, 60);
        context.strokeStyle = color;
        context.lineWidth = 3;
        context.strokeRect(18, 18, 60, 60);
        context.fillStyle = color;
        context.font = "700 42px Noto Sans KR";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(text, 48, 50);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture, transparent: true}));
    sprite.scale.set(0.38, 0.38, 0.38);

    return sprite;
}
