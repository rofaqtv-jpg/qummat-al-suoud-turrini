// ============================================================
// قمة الصعود | QIMMAT AL-SUOUD - TURRINISTUDIO
// نسخة نظيفة ومستقرة
// ============================================================

import {
    Engine,
    Scene,
    Vector3,
    Color3,
    HemisphericLight,
    DirectionalLight,
    ShadowGenerator,
    ArcRotateCamera,
    MeshBuilder,
    StandardMaterial,
    PhysicsAggregate,
    PhysicsShapeType,
    Quaternion
} from '@babylonjs/core';

import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin } from '@babylonjs/core/Physics';
import '@babylonjs/loaders/glTF';
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';

// ============================================================
// المتغيرات العامة
// ============================================================
let engine = null;
let scene = null;
let camera = null;
let vehicle = null;
let havokPlugin = null;

let inputState = {
    gas: false,
    brake: false,
    left: false,
    right: false,
    handbrake: false
};

let cameraMode = 0;
let gameActive = false;

// ============================================================
// فئة مركبة Raycast
// ============================================================
class RaycastVehicle {
    constructor(scene, chassisMesh) {
        this.scene = scene;
        this.chassis = chassisMesh;

        this.aggregate = new PhysicsAggregate(
            chassisMesh,
            PhysicsShapeType.BOX,
            { mass: 1200, friction: 0.5, restitution: 0.2 },
            scene
        );

        this.wheelInfos = [
            { offset: new Vector3(-1.1, -0.5, 1.5), isFront: true, engine: false },
            { offset: new Vector3(1.1, -0.5, 1.5), isFront: true, engine: false },
            { offset: new Vector3(-1.1, -0.5, -1.5), isFront: false, engine: true },
            { offset: new Vector3(1.1, -0.5, -1.5), isFront: false, engine: true }
        ];

        this.wheels = [];
        for (let i = 0; i < 4; i++) {
            const wheel = MeshBuilder.CreateCylinder(
                'wheel_' + i,
                { diameter: 0.8, height: 0.35, tessellation: 20 },
                scene
            );
            wheel.rotation.z = Math.PI / 2;
            wheel.material = new StandardMaterial('wheelMat_' + i, scene);
            wheel.material.diffuseColor = new Color3(0.1, 0.1, 0.1);
            this.wheels.push(wheel);
        }

        this.suspensionRestLength = 0.5;
        this.suspensionStiffness = 35;
        this.suspensionDamping = 3;
        this.wheelRadius = 0.4;
        this.maxSuspensionForce = 60000;

        this.engineForce = 0;
        this.brakeForce = 0;
        this.steerValue = 0;
        this.handbrake = false;
        this.speed = 0;
    }

    update() {
        if (!this.aggregate || !this.aggregate.body) return;

        const body = this.aggregate.body;
        const transform = body.getTransformNode();
        const chassisPos = transform.getAbsolutePosition();
        const forward = transform.forward;
        const right = transform.right;
        const up = transform.up;

        let totalForce = Vector3.Zero();

        const vel = body.getLinearVelocity();
        this.speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6;

        for (let i = 0; i < 4; i++) {
            const info = this.wheelInfos[i];

            const connectionWorld = chassisPos
                .add(right.scale(info.offset.x))
                .add(up.scale(info.offset.y))
                .add(forward.scale(info.offset.z));

            const rayDir = up.scale(-1);
            const rayLength = this.suspensionRestLength + this.wheelRadius + 0.5;
            const rayEnd = connectionWorld.add(rayDir.scale(rayLength));

            const physicsEngine = this.scene.getPhysicsEngine();
            if (!physicsEngine) continue;

            const hit = physicsEngine.raycast(connectionWorld, rayEnd);

            if (hit && hit.hasHit) {
                const hitPoint = hit.hitPointWorld;
                const hitDistance = hitPoint.subtract(connectionWorld).length();
                const suspensionLength = hitDistance - this.wheelRadius;
                let compression = this.suspensionRestLength - suspensionLength;

                if (compression > 0) {
                    let suspensionForce = compression * this.suspensionStiffness * 1000;

                    const pointVelocity = body.getLinearVelocityAtPoint(connectionWorld);
                    const dampingForce = pointVelocity.dot(up) * this.suspensionDamping * 1000;
                    suspensionForce -= dampingForce;

                    suspensionForce = Math.max(0, Math.min(suspensionForce, this.maxSuspensionForce));
                    totalForce.addInPlace(up.scale(suspensionForce));

                    let wheelForward = forward.clone();
                    if (info.isFront && Math.abs(this.steerValue) > 0.01) {
                        const steerQuat = Quaternion.RotationAxis(up, this.steerValue);
                        const rotMatrix = steerQuat.toRotationMatrix();
                        wheelForward = Vector3.TransformCoordinates(wheelForward, rotMatrix);
                    }

                    if (info.engine && Math.abs(this.engineForce) > 0) {
                        const engineVec = wheelForward.scale(this.engineForce / 2);
                        totalForce.addInPlace(engineVec);
                    }

                    if (this.brakeForce > 0) {
                        const pointVel = body.getLinearVelocityAtPoint(hitPoint);
                        totalForce.addInPlace(pointVel.scale(-this.brakeForce));
                    }

                    if (this.handbrake && !info.isFront) {
                        const pointVel = body.getLinearVelocityAtPoint(hitPoint);
                        totalForce.addInPlace(pointVel.scale(-50));
                    }

                    const lateralVel = body.getLinearVelocityAtPoint(hitPoint).dot(right);
                    totalForce.addInPlace(right.scale(-lateralVel * 8));

                    this.wheels[i].position = hitPoint.add(up.scale(this.wheelRadius * 0.5));
                    this.wheels[i].rotationQuaternion = transform.rotationQuaternion.clone();

                    if (this.speed > 1) {
                        const rollQuat = Quaternion.RotationAxis(right, this.speed * 0.03);
                        this.wheels[i].rotationQuaternion.multiplyInPlace(rollQuat);
                    }

                    if (info.isFront) {
                        const steerVisual = Quaternion.RotationAxis(up, this.steerValue * 0.8);
                        this.wheels[i].rotationQuaternion.multiplyInPlace(steerVisual);
                    }
                }
            } else {
                this.wheels[i].position = connectionWorld.add(rayDir.scale(this.suspensionRestLength));
                this.wheels[i].rotationQuaternion = transform.rotationQuaternion.clone();
            }
        }

        body.applyForce(totalForce, chassisPos);

        const dragForce = vel.scale(-0.3);
        body.applyForce(dragForce, chassisPos);

        const euler = transform.rotationQuaternion ? transform.rotationQuaternion.toEulerAngles() : new Vector3(0, 0, 0);
        if (Math.abs(euler.x) > 1.4 || Math.abs(euler.z) > 1.4) {
            body.setAngularVelocity(Vector3.Zero());
        }
    }

    setThrottle(value) {
        this.engineForce = value * 3000;
    }

    setBrake(value) {
        this.brakeForce = value * 200;
    }

    setSteer(value) {
        this.steerValue = value * 0.45;
    }

    setHandbrake(active) {
        this.handbrake = active;
    }

    reset() {
        if (!this.aggregate || !this.aggregate.body) return;
        const body = this.aggregate.body;
        const transform = body.getTransformNode();
        transform.position = new Vector3(0, 5, 0);
        transform.rotation = new Vector3(0, 0, 0);
        transform.rotationQuaternion = Quaternion.Identity();
        body.setLinearVelocity(Vector3.Zero());
        body.setAngularVelocity(Vector3.Zero());
    }
}

// ============================================================
// تهيئة اللعبة
// ============================================================
async function initGame() {
    try {
        updateLoadingStatus('تهيئة محرك الرسوميات...');
        const canvas = document.getElementById('renderCanvas');
        engine = new Engine(canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true,
            powerPreference: 'high-performance'
        });
        scene = new Scene(engine);
        scene.clearColor = new Color3(0.5, 0.7, 0.9);

        updateLoadingStatus('تحميل محرك فيزياء Havok...');
        await initHavok();

        updateLoadingStatus('بناء العالم الجبلي...');
        const shadowGen = createLighting();
        createWorld(shadowGen);

        updateLoadingStatus('تصنيع السيارة...');
        createVehicle(shadowGen);

        updateLoadingStatus('تهيئة الكاميرا...');
        setupCamera(canvas);

        scene.onBeforeRenderObservable.add(function () {
            if (vehicle && gameActive) {
                vehicle.setThrottle(inputState.gas ? 1 : 0);
                vehicle.setBrake(inputState.brake ? 1 : 0);
                vehicle.setSteer((inputState.left ? 1 : 0) - (inputState.right ? 1 : 0));
                vehicle.setHandbrake(inputState.handbrake);
                vehicle.update();
                updateCamera();
                updateHUD();
            }
        });

        hideSplash();
        showMainMenu();

        engine.runRenderLoop(function () {
            scene.render();
        });

        window.addEventListener('resize', function () {
            engine.resize();
        });

        console.log('✅ تم تحميل اللعبة بنجاح!');

    } catch (error) {
        console.error('❌ خطأ فادح:', error);
        showError('فشل تشغيل اللعبة', error.message || String(error));
    }
}

// ============================================================
// تهيئة Havok
// ============================================================
async function initHavok() {
    try {
        const havokInstance = await HavokPhysics({
            locateFile: function () {
                return havokWasmUrl;
            }
        });

        havokPlugin = new HavokPlugin(true, havokInstance);
        scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);
        console.log('✅ Havok Physics جاهز');
    } catch (error) {
        console.error('❌ فشل تحميل Havok:', error);
        throw new Error('تعذر تحميل محرك فيزياء Havok: ' + error.message);
    }
}

// ============================================================
// الإضاءة
// ============================================================
function createLighting() {
    const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.6;
    hemiLight.diffuse = new Color3(1, 0.98, 0.9);

    const dirLight = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene);
    dirLight.position = new Vector3(30, 50, 30);
    dirLight.intensity = 1.2;

    const shadowGen = new ShadowGenerator(1024, dirLight);
    shadowGen.useBlurExponentialShadowMap = true;
    shadowGen.blurKernel = 16;

    return shadowGen;
}

// ============================================================
// بناء العالم
// ============================================================
function createWorld(shadowGen) {
    // أرضية
    const ground = MeshBuilder.CreateGround('ground', {
        width: 200,
        height: 200,
        subdivisions: 60
    }, scene);

    const positions = ground.getVerticesData('position');
    if (positions) {
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            positions[i + 1] = Math.sin(x * 0.08) * 3 + Math.cos(z * 0.08) * 3;
        }
        ground.updateVerticesData('position', positions);
    }

    ground.material = new StandardMaterial('groundMat', scene);
    ground.material.diffuseColor = new Color3(0.5, 0.4, 0.3);
    ground.material.specularColor = new Color3(0.1, 0.1, 0.1);
    ground.receiveShadows = true;

    new PhysicsAggregate(ground, PhysicsShapeType.MESH, {
        mass: 0,
        friction: 0.8
    }, scene);

    // طريق
    const road = MeshBuilder.CreatePlane('road', { width: 8, height: 180 }, scene);
    road.rotation.x = Math.PI / 2;
    road.position.y = 0.3;
    road.material = new StandardMaterial('roadMat', scene);
    road.material.diffuseColor = new Color3(0.2, 0.2, 0.2);

    // صخور
    for (let i = 0; i < 20; i++) {
        const rock = MeshBuilder.CreateSphere('rock_' + i, {
            diameter: 2 + Math.random() * 4,
            segments: 6
        }, scene);
        rock.position = new Vector3(
            (Math.random() - 0.5) * 160,
            12,
            (Math.random() - 0.5) * 160
        );
        rock.material = new StandardMaterial('rockMat_' + i, scene);
        rock.material.diffuseColor = new Color3(0.35, 0.33, 0.32);
        shadowGen.addShadowCaster(rock);
        new PhysicsAggregate(rock, PhysicsShapeType.SPHERE, {
            mass: 15,
            friction: 0.7
        }, scene);
    }

    // أشجار
    for (let i = 0; i < 15; i++) {
        const trunk = MeshBuilder.CreateCylinder('trunk_' + i, {
            diameter: 0.5,
            height: 3,
            tessellation: 6
        }, scene);
        trunk.position = new Vector3(
            (Math.random() - 0.5) * 180,
            1.5,
            (Math.random() - 0.5) * 180
        );
        trunk.material = new StandardMaterial('trunkMat_' + i, scene);
        trunk.material.diffuseColor = new Color3(0.4, 0.25, 0.1);
        shadowGen.addShadowCaster(trunk);
        new PhysicsAggregate(trunk, PhysicsShapeType.CYLINDER, { mass: 0 }, scene);

        const leaves = MeshBuilder.CreateSphere('leaves_' + i, {
            diameter: 2.5,
            segments: 6
        }, scene);
        leaves.position.y = 2.5;
        leaves.parent = trunk;
        leaves.material = new StandardMaterial('leavesMat_' + i, scene);
        leaves.material.diffuseColor = new Color3(0.1, 0.4, 0.1);
        shadowGen.addShadowCaster(leaves);
    }
}

// ============================================================
// إنشاء السيارة
// ============================================================
function createVehicle(shadowGen) {
    const chassis = MeshBuilder.CreateBox('chassis', {
        width: 2,
        height: 0.9,
        depth: 4
    }, scene);
    chassis.position.y = 2;
    chassis.material = new StandardMaterial('chassisMat', scene);
    chassis.material.diffuseColor = new Color3(0.9, 0.1, 0.1);
    shadowGen.addShadowCaster(chassis);

    const cabin = MeshBuilder.CreateBox('cabin', {
        width: 1.8,
        height: 0.7,
        depth: 2
    }, scene);
    cabin.position = new Vector3(0, 0.9, -0.3);
    cabin.parent = chassis;
    cabin.material = new StandardMaterial('cabinMat', scene);
    cabin.material.diffuseColor = new Color3(0.7, 0.05, 0.05);
    shadowGen.addShadowCaster(cabin);

    vehicle = new RaycastVehicle(scene, chassis);
}

// ============================================================
// الكاميرا
// ============================================================
function setupCamera(canvas) {
    camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.5, 12, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 4;
    camera.upperRadiusLimit = 25;
    camera.lowerBetaLimit = 0.3;
    camera.upperBetaLimit = Math.PI / 1.8;
}

function updateCamera() {
    if (!vehicle || !camera) return;
    const target = vehicle.chassis.position;

    if (cameraMode === 0) {
        camera.setTarget(target);
        camera.radius += (12 - camera.radius) * 0.05;
        camera.alpha += (Math.PI - camera.alpha) * 0.03;
        camera.beta += (Math.PI / 2.5 - camera.beta) * 0.05;
    } else if (cameraMode === 1) {
        camera.position = target.add(new Vector3(0, 1.2, 0.5));
        camera.setTarget(target.add(vehicle.chassis.forward.scale(20)));
    } else {
        camera.position = target.add(new Vector3(0, 18, 0.1));
        camera.setTarget(target);
    }
}

// ============================================================
// واجهة المستخدم
// ============================================================
function updateHUD() {
    if (!vehicle) return;
    const speedEl = document.getElementById('speedometer');
    const gearEl = document.getElementById('gear-indicator');
    if (speedEl) speedEl.innerText = Math.floor(vehicle.speed) + ' km/h';
    if (gearEl) gearEl.innerText = 'D';
}

function updateLoadingStatus(msg) {
    const el = document.querySelector('.loading-text');
    if (el) el.innerText = msg;
}

function hideSplash() {
    const el = document.getElementById('splash-screen');
    if (el) el.classList.add('hidden');
}

function showMainMenu() {
    const el = document.getElementById('main-menu');
    if (el) el.classList.remove('hidden');
}

function showError(title, details) {
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.remove('hidden');
        splash.innerHTML =
            '<div class="logo-container" style="text-align:center;padding:20px;">' +
            '<h1 style="color:#e74c3c;font-size:2rem;">⚠️ ' + title + '</h1>' +
            '<p style="color:#aaa;background:#111;padding:15px;border-radius:5px;direction:ltr;text-align:left;font-family:monospace;max-height:200px;overflow:auto;">' + details + '</p>' +
            '<button onclick="location.reload()" style="margin-top:20px;min-width:200px;">إعادة المحاولة 🔄</button>' +
            '</div>';
    }
}

// ============================================================
// أزرار الواجهة
// ============================================================
window.startGame = function () {
    const menu = document.getElementById('main-menu');
    const hud = document.getElementById('game-hud');
    if (menu) menu.classList.add('hidden');
    if (hud) hud.classList.remove('hidden');
    gameActive = true;
    if (vehicle) vehicle.reset();
};

window.showMainMenu = function () {
    const menu = document.getElementById('main-menu');
    const hud = document.getElementById('game-hud');
    if (hud) hud.classList.add('hidden');
    if (menu) menu.classList.remove('hidden');
    gameActive = false;
};

window.resetCar = function () {
    if (vehicle) vehicle.reset();
};

window.toggleCamera = function () {
    cameraMode = (cameraMode + 1) % 3;
};

window.showImport = function () {
    const el = document.getElementById('import-panel');
    if (el) el.classList.remove('hidden');
};

window.closeImport = function () {
    const el = document.getElementById('import-panel');
    if (el) el.classList.add('hidden');
};

window.showGarage = function () {
    const el = document.getElementById('garage-panel');
    if (el) el.classList.remove('hidden');
};

window.closeGarage = function () {
    const el = document.getElementById('garage-panel');
    if (el) el.classList.add('hidden');
};

window.toggleSettings = function () {
    alert('⚙️ الإعدادات قيد التطوير');
};

window.showMultiplayer = function () {
    alert('🌐 اللعب الجماعي قيد التطوير');
};

window.changeCarColor = function (color) {
    if (vehicle && vehicle.chassis && vehicle.chassis.material) {
        vehicle.chassis.material.diffuseColor = Color3.FromHexString(color);
    }
};

window.upgrade = function (type) {
    alert('✅ تمت الترقية: ' + type);
};

/// ============================================================
// ربط أزرار التحكم - نظام موثوق 100%
// ============================================================

function setupControls() {
    // دالة ربط موحدة تعمل مع اللمس والماوس
    function bindControl(buttonId, inputKey) {
        const btn = document.getElementById(buttonId);
        if (!btn) {
            console.warn('⚠️ زر غير موجود:', buttonId);
            return;
        }

        // إضافة فئة نشطة للتأثير البصري
        function activate(e) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            inputState[inputKey] = true;
            btn.classList.add('active');
            console.log('🎮 تفعيل:', inputKey);
        }

        function deactivate(e) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            inputState[inputKey] = false;
            btn.classList.remove('active');
        }

        // أحداث اللمس
        btn.addEventListener('touchstart', activate, { passive: false });
        btn.addEventListener('touchend', deactivate, { passive: false });
        btn.addEventListener('touchcancel', deactivate, { passive: false });

        // أحداث الماوس
        btn.addEventListener('mousedown', activate);
        btn.addEventListener('mouseup', deactivate);
        btn.addEventListener('mouseleave', deactivate);

        // أحداث المؤشر (للأجهزة اللوحية)
        btn.addEventListener('pointerdown', activate);
        btn.addEventListener('pointerup', deactivate);
        btn.addEventListener('pointercancel', deactivate);
    }

    // ربط جميع الأزرار
    bindControl('btn-gas', 'gas');
    bindControl('btn-brake', 'brake');
    bindControl('btn-left', 'left');
    bindControl('btn-right', 'right');
    bindControl('btn-handbrake', 'handbrake');

    // أزرار الواجهة
    const resetBtn = document.getElementById('btn-reset');
    if (resetBtn) {
        resetBtn.addEventListener('click', function () {
            resetCar();
        });
    }

    const cameraBtn = document.getElementById('btn-camera');
    if (cameraBtn) {
        cameraBtn.addEventListener('click', function () {
            toggleCamera();
        });
    }

    const exitBtn = document.getElementById('btn-exit');
    if (exitBtn) {
        exitBtn.addEventListener('click', function () {
            showMainMenu();
        });
    }

    console.log('✅ تم ربط جميع أزرار التحكم');
}

// لوحة المفاتيح
function setupKeyboard() {
    window.addEventListener('keydown', function (e) {
        switch (e.key) {
            case 'w':
            case 'W':
            case 'ArrowUp':
                inputState.gas = true;
                break;
            case 's':
            case 'S':
            case 'ArrowDown':
                inputState.brake = true;
                break;
            case 'a':
            case 'A':
            case 'ArrowLeft':
                inputState.left = true;
                break;
            case 'd':
            case 'D':
            case 'ArrowRight':
                inputState.right = true;
                break;
            case ' ':
                inputState.handbrake = true;
                break;
        }
    });

    window.addEventListener('keyup', function (e) {
        switch (e.key) {
            case 'w':
            case 'W':
            case 'ArrowUp':
                inputState.gas = false;
                break;
            case 's':
            case 'S':
            case 'ArrowDown':
                inputState.brake = false;
                break;
            case 'a':
            case 'A':
            case 'ArrowLeft':
                inputState.left = false;
                break;
            case 'd':
            case 'D':
            case 'ArrowRight':
                inputState.right = false;
                break;
            case ' ':
                inputState.handbrake = false;
                break;
        }
    });

    console.log('✅ تم ربط لوحة المفاتيح');
}

// محاولة قفل الاتجاه الأفقي
function lockLandscape() {
    // محاولة قفل الاتجاه عبر Screen Orientation API
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('landscape').catch(function (err) {
            console.log('⚠️ تعذر قفل الاتجاه:', err.message);
        });
    }

    // محاولة عبر meta tag (لأجهزة iOS)
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
        meta.setAttribute('content',
            'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
        );
    }
}

// دوال الواجهة
window.startGame = function () {
    const menu = document.getElementById('main-menu');
    const hud = document.getElementById('game-hud');
    if (menu) menu.classList.add('hidden');
    if (hud) hud.classList.remove('hidden');
    gameActive = true;
    lockLandscape();
    if (vehicle) vehicle.reset();
    console.log('🎮 بدء اللعبة');
};

window.showMainMenu = function () {
    const menu = document.getElementById('main-menu');
    const hud = document.getElementById('game-hud');
    if (hud) hud.classList.add('hidden');
    if (menu) menu.classList.remove('hidden');
    gameActive = false;
};

window.resetCar = function () {
    if (vehicle) {
        vehicle.reset();
        console.log('↺ إعادة السيارة');
    }
};

window.toggleCamera = function () {
    cameraMode = (cameraMode + 1) % 3;
    const modes = ['خلفية', 'قمرة القيادة', 'علوية'];
    console.log('📷 الكاميرا:', modes[cameraMode]);
};

window.showImport = function () {
    const el = document.getElementById('import-panel');
    if (el) el.classList.remove('hidden');
};

window.closeImport = function () {
    const el = document.getElementById('import-panel');
    if (el) el.classList.add('hidden');
};

window.showGarage = function () {
    const el = document.getElementById('garage-panel');
    if (el) el.classList.remove('hidden');
};

window.closeGarage = function () {
    const el = document.getElementById('garage-panel');
    if (el) el.classList.add('hidden');
};

window.toggleSettings = function () {
    alert('⚙️ الإعدادات قيد التطوير');
};

window.showMultiplayer = function () {
    alert('👥 اللعب الجماعي قيد التطوير');
};

window.changeCarColor = function (color) {
    if (vehicle && vehicle.chassis && vehicle.chassis.material) {
        vehicle.chassis.material.diffuseColor = Color3.FromHexString(color);
        console.log('🎨 تغيير اللون إلى:', color);
    }
};

window.upgrade = function (type) {
    console.log('⬆️ ترقية:', type);
    alert('✅ تمت الترقية!');
};

// استيراد المودات
function setupModImport() {
    const fileInput = document.getElementById('mod-file-input');
    if (!fileInput) return;

    fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;

        const status = document.getElementById('import-status');
        if (status) status.innerText = '⏳ جاري التحميل...';

        const url = URL.createObjectURL(file);

        SceneLoader.ImportMeshAsync('', '', url, scene).then(function (result) {
            if (status) status.innerText = '✅ تم الاستيراد بنجاح!';
            console.log('📦 تم استيراد:', file.name);
            setTimeout(closeImport, 1500);
        }).catch(function (err) {
            if (status) status.innerText = '❌ خطأ: ' + err.message;
            console.error('❌ فشل الاستيراد:', err);
        });
    });
}

// ============================================================
// التهيئة النهائية
// ============================================================
function initControls() {
    setupControls();
    setupKeyboard();
    setupModImport();
    console.log('🎮 نظام التحكم جاهز');
}

// استدعاء التهيئة بعد تحميل الصفحة
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initControls);
} else {
    initControls();
}

// بدء اللعبة
initGame().catch(function (err) {
    console.error('💥 خطأ فادح:', err);
    showError('تعذر بدء اللعبة', err.message || String(err));
});

// لوحة المفاتيح
window.addEventListener('keydown', function (e) {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = true;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = true;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = true;
    if (e.key === ' ') inputState.handbrake = true;
});

window.addEventListener('keyup', function (e) {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = false;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = false;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = false;
    if (e.key === ' ') inputState.handbrake = false;
});

// ============================================================
// بدء التشغيل
// ============================================================
initGame().catch(function (err) {
    console.error('💥 خطأ غير متوقع:', err);
    showError('تعذر بدء اللعبة', err.message || String(err));
});
