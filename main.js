// ============================================================
// قمة الصعود | QIMMAT AL-SUOUD - TURRINISTUDIO
// نسخة مُحصّنة مع تشخيص كامل
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
    Quaternion
} from '@babylonjs/core';

import '@babylonjs/loaders/glTF';

// ============================================================
// المتغيرات العامة
// ============================================================
let engine = null;
let scene = null;
let camera = null;
let vehicle = null;
let physicsEnabled = false;

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
// فئة مركبة مبسطة (تعمل بدون فيزياء خارجية)
// ============================================================
class SimpleVehicle {
    constructor(scene, chassisMesh) {
        this.scene = scene;
        this.chassis = chassisMesh;

        // الحالة الأساسية
        this.position = chassisMesh.position.clone();
        this.rotation = new Vector3(0, 0, 0);
        this.velocity = new Vector3(0, 0, 0);
        this.angularVelocity = 0;

        // خصائص السيارة
        this.mass = 1200;
        this.enginePower = 3000;
        this.brakePower = 200;
        this.maxSpeed = 50; // m/s
        this.steerSpeed = 0.03;
        this.friction = 0.98;
        this.gravity = -9.81;

        // العجلات المرئية
        this.wheels = [];
        this.wheelRadius = 0.4;
        this.wheelBase = 3.0;
        this.trackWidth = 2.2;

        for (let i = 0; i < 4; i++) {
            const wheel = MeshBuilder.CreateCylinder(
                'wheel_' + i,
                { diameter: this.wheelRadius * 2, height: 0.35, tessellation: 20 },
                scene
            );
            wheel.rotation.z = Math.PI / 2;
            wheel.material = new StandardMaterial('wheelMat_' + i, scene);
            wheel.material.diffuseColor = new Color3(0.1, 0.1, 0.1);
            this.wheels.push(wheel);
        }

        // حالة التحكم
        this.throttle = 0;
        this.brake = 0;
        this.steer = 0;
        this.handbrake = false;
        this.speed = 0;
        this.grounded = true;

        console.log('🚗 تم إنشاء المركبة');
    }

    update(deltaTime) {
        if (!this.chassis) return;

        // حساب الاتجاهات
        const forward = new Vector3(
            Math.sin(this.rotation.y),
            0,
            Math.cos(this.rotation.y)
        );
        const right = new Vector3(
            Math.cos(this.rotation.y),
            0,
            -Math.sin(this.rotation.y)
        );

        // 1. قوة المحرك
        let engineForce = 0;
        if (this.throttle > 0) {
            engineForce = this.throttle * this.enginePower;
        }
        if (this.brake > 0) {
            engineForce = -this.brake * this.brakePower * 2;
        }

        // تطبيق القوة
        const acceleration = forward.scale(engineForce / this.mass);
        this.velocity.addInPlace(acceleration.scale(deltaTime));

        // 2. التوجيه
        if (Math.abs(this.steer) > 0.01 && Math.abs(this.speed) > 0.5) {
            const steerAmount = this.steer * this.steerSpeed * Math.min(Math.abs(this.speed) / 10, 1);
            this.rotation.y += steerAmount;
        }

        // 3. الاحتكاك والمقاومة
        this.velocity.scaleInPlace(this.friction);

        // 4. الجاذبية
        this.velocity.y += this.gravity * deltaTime;

        // 5. تحديث الموقع
        this.position.addInPlace(this.velocity.scale(deltaTime));

        // 6. منع السقوط تحت الأرض
        if (this.position.y < 1) {
            this.position.y = 1;
            this.velocity.y = 0;
            this.grounded = true;
        } else {
            this.grounded = false;
        }

        // 7. حساب السرعة
        this.speed = Math.sqrt(
            this.velocity.x * this.velocity.x +
            this.velocity.z * this.velocity.z
        );

        // 8. تحديث موقع الهيكل
        this.chassis.position.copyFrom(this.position);
        this.chassis.rotation.copyFrom(this.rotation);

        // 9. تحديث العجلات
        this.updateWheels(forward, right);

        // 10. تشخيص
        if (Math.random() < 0.01) {
            console.log('🚗 السرعة:', this.speed.toFixed(1),
                       '| الموقع:', this.position.y.toFixed(1),
                       '| الوقود:', this.throttle);
        }
    }

    updateWheels(forward, right) {
        const wheelPositions = [
            new Vector3(-this.trackWidth / 2, -0.5, this.wheelBase / 2),  // أمام يسار
            new Vector3(this.trackWidth / 2, -0.5, this.wheelBase / 2),   // أمام يمين
            new Vector3(-this.trackWidth / 2, -0.5, -this.wheelBase / 2), // خلف يسار
            new Vector3(this.trackWidth / 2, -0.5, -this.wheelBase / 2)   // خلف يمين
        ];

        for (let i = 0; i < 4; i++) {
            const offset = wheelPositions[i];

            // تطبيق الدوران على الإزاحة
            const rotatedOffset = new Vector3(
                offset.x * Math.cos(this.rotation.y) + offset.z * Math.sin(this.rotation.y),
                offset.y,
                -offset.x * Math.sin(this.rotation.y) + offset.z * Math.cos(this.rotation.y)
            );

            this.wheels[i].position.copyFrom(this.position.add(rotatedOffset));
            this.wheels[i].rotation.y = this.rotation.y;

            // توجيه العجلات الأمامية
            if (i < 2) {
                this.wheels[i].rotation.y += this.steer * 0.5;
            }

            // تدوير العجلات حسب السرعة
            this.wheels[i].rotation.x += this.speed * 0.1;
        }
    }

    setThrottle(value) {
        this.throttle = Math.max(0, Math.min(1, value));
    }

    setBrake(value) {
        this.brake = Math.max(0, Math.min(1, value));
    }

    setSteer(value) {
        this.steer = Math.max(-1, Math.min(1, value));
    }

    setHandbrake(active) {
        this.handbrake = active;
        if (active) {
            this.velocity.scaleInPlace(0.95);
        }
    }

    reset() {
        this.position = new Vector3(0, 2, 0);
        this.rotation = new Vector3(0, 0, 0);
        this.velocity = new Vector3(0, 0, 0);
        this.speed = 0;
        this.throttle = 0;
        this.brake = 0;
        this.steer = 0;
        console.log('↺ إعادة تعيين السيارة');
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
            stencil: true
        });
        scene = new Scene(engine);
        scene.clearColor = new Color3(0.5, 0.7, 0.9);

        updateLoadingStatus('بناء العالم...');
        createWorld();

        updateLoadingStatus('تصنيع السيارة...');
        createVehicle();

        updateLoadingStatus('تهيئة الكاميرا...');
        setupCamera(canvas);

        // حلقة اللعبة
        let lastTime = performance.now();

        scene.onBeforeRenderObservable.add(function () {
            const currentTime = performance.now();
            const deltaTime = Math.min((currentTime - lastTime) / 1000, 0.1);
            lastTime = currentTime;

            if (vehicle && gameActive) {
                // تطبيق المدخلات
                vehicle.setThrottle(inputState.gas ? 1 : 0);
                vehicle.setBrake(inputState.brake ? 1 : 0);
                vehicle.setSteer((inputState.left ? 1 : 0) - (inputState.right ? 1 : 0));
                vehicle.setHandbrake(inputState.handbrake);

                // تحديث الفيزياء
                vehicle.update(deltaTime);

                // تحديث الكاميرا والـ HUD
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
        console.log('🎮 الفيزياء: مبسطة (بدون Havok)');

    } catch (error) {
        console.error('❌ خطأ فادح:', error);
        showError('فشل تشغيل اللعبة', error.message || String(error));
    }
}

// ============================================================
// بناء العالم
// ============================================================
function createWorld() {
    // إضاءة
    const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.7;

    const dirLight = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene);
    dirLight.position = new Vector3(30, 50, 30);
    dirLight.intensity = 1.0;

    const shadowGen = new ShadowGenerator(1024, dirLight);

    // أرضية
    const ground = MeshBuilder.CreateGround('ground', {
        width: 200,
        height: 200,
        subdivisions: 40
    }, scene);

    // إضافة تضاريس بسيطة
    const positions = ground.getVerticesData('position');
    if (positions) {
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            positions[i + 1] = Math.sin(x * 0.05) * 2 + Math.cos(z * 0.05) * 2;
        }
        ground.updateVerticesData('position', positions);
    }

    ground.material = new StandardMaterial('groundMat', scene);
    ground.material.diffuseColor = new Color3(0.5, 0.4, 0.3);
    ground.receiveShadows = true;

    // طريق
    const road = MeshBuilder.CreatePlane('road', { width: 10, height: 180 }, scene);
    road.rotation.x = Math.PI / 2;
    road.position.y = 0.1;
    road.material = new StandardMaterial('roadMat', scene);
    road.material.diffuseColor = new Color3(0.2, 0.2, 0.2);

    // صخور
    for (let i = 0; i < 15; i++) {
        const rock = MeshBuilder.CreateSphere('rock_' + i, {
            diameter: 2 + Math.random() * 3,
            segments: 6
        }, scene);
        rock.position = new Vector3(
            (Math.random() - 0.5) * 150,
            5,
            (Math.random() - 0.5) * 150
        );
        rock.material = new StandardMaterial('rockMat_' + i, scene);
        rock.material.diffuseColor = new Color3(0.35, 0.33, 0.32);
        shadowGen.addShadowCaster(rock);
    }

    // أشجار
    for (let i = 0; i < 10; i++) {
        const trunk = MeshBuilder.CreateCylinder('trunk_' + i, {
            diameter: 0.5,
            height: 3,
            tessellation: 6
        }, scene);
        trunk.position = new Vector3(
            (Math.random() - 0.5) * 160,
            1.5,
            (Math.random() - 0.5) * 160
        );
        trunk.material = new StandardMaterial('trunkMat_' + i, scene);
        trunk.material.diffuseColor = new Color3(0.4, 0.25, 0.1);
        shadowGen.addShadowCaster(trunk);
    }
}

// ============================================================
// إنشاء السيارة
// ============================================================
function createVehicle() {
    const chassis = MeshBuilder.CreateBox('chassis', {
        width: 2,
        height: 0.9,
        depth: 4
    }, scene);
    chassis.position.y = 2;
    chassis.material = new StandardMaterial('chassisMat', scene);
    chassis.material.diffuseColor = new Color3(0.9, 0.1, 0.1);

    const cabin = MeshBuilder.CreateBox('cabin', {
        width: 1.8,
        height: 0.7,
        depth: 2
    }, scene);
    cabin.position = new Vector3(0, 0.9, -0.3);
    cabin.parent = chassis;
    cabin.material = new StandardMaterial('cabinMat', scene);
    cabin.material.diffuseColor = new Color3(0.7, 0.05, 0.05);

    vehicle = new SimpleVehicle(scene, chassis);
}

// ============================================================
// الكاميرا
// ============================================================
function setupCamera(canvas) {
    camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.5, 12, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 4;
    camera.upperRadiusLimit = 25;
}

function updateCamera() {
    if (!vehicle || !camera) return;
    const target = vehicle.position;

    if (cameraMode === 0) {
        camera.setTarget(target);
        camera.radius += (12 - camera.radius) * 0.05;
        camera.alpha += (Math.PI - camera.alpha) * 0.03;
        camera.beta += (Math.PI / 2.5 - camera.beta) * 0.05;
    } else if (cameraMode === 1) {
        camera.position = target.add(new Vector3(0, 1.5, 0.5));
        camera.setTarget(target.add(new Vector3(
            Math.sin(vehicle.rotation.y) * 20,
            0,
            Math.cos(vehicle.rotation.y) * 20
        )));
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
    if (speedEl) {
        speedEl.innerText = Math.floor(vehicle.speed * 3.6);
    }
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
            '<h1 style="color:#e74c3c;">⚠️ ' + title + '</h1>' +
            '<p style="color:#aaa;background:#111;padding:15px;border-radius:5px;direction:ltr;">' + details + '</p>' +
            '<button onclick="location.reload()" style="margin-top:20px;">إعادة المحاولة</button>' +
            '</div>';
    }
}

// ============================================================
// ربط أزرار التحكم
// ============================================================
function setupControls() {
    function bindControl(buttonId, inputKey) {
        const btn = document.getElementById(buttonId);
        if (!btn) {
            console.warn('⚠️ زر غير موجود:', buttonId);
            return;
        }

        function activate(e) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            inputState[inputKey] = true;
            btn.classList.add('active');
            console.log('🎮 تفعيل:', inputKey, '| gameActive:', gameActive);
        }

        function deactivate(e) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            inputState[inputKey] = false;
            btn.classList.remove('active');
        }

        btn.addEventListener('touchstart', activate, { passive: false });
        btn.addEventListener('touchend', deactivate, { passive: false });
        btn.addEventListener('touchcancel', deactivate, { passive: false });
        btn.addEventListener('mousedown', activate);
        btn.addEventListener('mouseup', deactivate);
        btn.addEventListener('mouseleave', deactivate);
    }

    bindControl('btn-gas', 'gas');
    bindControl('btn-brake', 'brake');
    bindControl('btn-left', 'left');
    bindControl('btn-right', 'right');
    bindControl('btn-handbrake', 'handbrake');

    // أزرار الواجهة
    const resetBtn = document.getElementById('btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetCar);

    const cameraBtn = document.getElementById('btn-camera');
    if (cameraBtn) cameraBtn.addEventListener('click', toggleCamera);

    const exitBtn = document.getElementById('btn-exit');
    if (exitBtn) exitBtn.addEventListener('click', showMainMenu);

    console.log('✅ تم ربط أزرار التحكم');
}

// لوحة المفاتيح
function setupKeyboard() {
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

    console.log('✅ تم ربط لوحة المفاتيح');
}

// ============================================================
// دوال الواجهة
// ============================================================
window.startGame = function () {
    console.log('🎮 بدء اللعبة!');
    const menu = document.getElementById('main-menu');
    const hud = document.getElementById('game-hud');
    if (menu) menu.classList.add('hidden');
    if (hud) hud.classList.remove('hidden');

    gameActive = true;
    console.log('✅ gameActive = true');

    if (vehicle) {
        vehicle.reset();
        console.log('✅ تم إعادة تعيين السيارة');
    }
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
    }
};

window.upgrade = function (type) {
    alert('✅ تمت الترقية: ' + type);
};

// ============================================================
// التهيئة النهائية
// ============================================================
function initControls() {
    setupControls();
    setupKeyboard();
    console.log('🎮 نظام التحكم جاهز');
}

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
