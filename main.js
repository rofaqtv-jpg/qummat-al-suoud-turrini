import { Engine, Scene, Vector3, Color3, HemisphericLight, DirectionalLight, ShadowGenerator, ArcRotateCamera, MeshBuilder, StandardMaterial, PhysicsAggregate, PhysicsShapeType, HavokPlugin, SceneLoader, AbstractMesh } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import HavokPhysics from '@babylonjs/havok';

// متغيرات عالمية
let engine, scene, camera, vehicle, havokPlugin;
let inputState = { gas: false, brake: false, left: false, right: false };
let cameraMode = 0; // 0: Follow, 1: Cockpit, 2: Top
let carStats = { enginePower: 150, suspensionStiffness: 30, maxSpeed: 120 };

// تهيئة اللعبة
async function initGame() {
    const canvas = document.getElementById('renderCanvas');
    engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
    scene = new Scene(engine);

    // 1. تهيئة Havok Physics
    const havokInstance = await HavokPhysics();
    havokPlugin = new HavokPlugin(true, havokInstance);
    scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);

    // 2. الإضاءة والبيئة
    const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.6;
    const dirLight = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene);
    dirLight.position = new Vector3(20, 40, 20);
    dirLight.intensity = 1.2;
    const shadowGenerator = new ShadowGenerator(1024, dirLight);

    // 3. إنشاء العالم الجبلي (تضاريس بسيطة قابلة للقيادة)
    createMountainWorld(scene, shadowGenerator);

    // 4. إنشاء المركبة الافتراضية
    createDefaultVehicle(scene, shadowGenerator);

    // 5. الكاميرا
    camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 3;
    camera.upperRadiusLimit = 20;

    // 6. حلقة اللعبة
    scene.onBeforeRenderObservable.add(() => {
        if (vehicle) updateVehiclePhysics();
        updateCamera();
        updateHUD();
    });

    // إخفاء شاشة التحميل
    document.getElementById('splash-screen').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
    
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
}

// إنشاء عالم جبلي
function createMountainWorld(scene, shadowGen) {
    // أرضية أساسية
    const ground = MeshBuilder.CreateGround('ground', { width: 200, height: 200, subdivisions: 50 }, scene);
    const positions = ground.getVerticesData('position');
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i + 2];
        // توليد تضاريس جبلية بسيطة باستخدام دالة جيبية
        const height = Math.sin(x * 0.05) * 3 + Math.cos(z * 0.05) * 3 + Math.random() * 0.5;
        positions[i + 1] = height > 0 ? height : 0;
    }
    ground.updateVerticesData('position', positions);
    ground.createDefaultPhysicsAggregate({ mass: 0, friction: 0.8, restitution: 0.1 });

    const mat = new StandardMaterial('groundMat', scene);
    mat.diffuseColor = new Color3(0.4, 0.3, 0.2); // لون ترابي/جبلي
    ground.material = mat;
    ground.receiveShadows = true;

    // إضافة بعض العوائق (صخور)
    for (let i = 0; i < 15; i++) {
        const rock = MeshBuilder.CreateSphere('rock' + i, { diameter: 2 + Math.random() * 3 }, scene);
        rock.position = new Vector3((Math.random() - 0.5) * 100, 5, (Math.random() - 0.5) * 100);
        rock.createDefaultPhysicsAggregate({ mass: 5, friction: 0.6 });
        const rockMat = new StandardMaterial('rockMat', scene);
        rockMat.diffuseColor = new Color3(0.3, 0.3, 0.3);
        rock.material = rockMat;
        shadowGen.addShadowCaster(rock);
    }
}

// إنشاء مركبة افتراضية (Jeep)
function createDefaultVehicle(scene, shadowGen) {
    const chassis = MeshBuilder.CreateBox('chassis', { width: 2, height: 1, depth: 4 }, scene);
    chassis.position.y = 2;
    const chassisMat = new StandardMaterial('chassisMat', scene);
    chassisMat.diffuseColor = new Color3(0.9, 0.1, 0.1); // أحمر
    chassis.material = chassisMat;
    chassis.createDefaultPhysicsAggregate({ mass: 150, friction: 0.5, restitution: 0.2 });
    shadowGen.addShadowCaster(chassis);

    // عجلات وهمية للعرض (الفيزياء تعتمد على Raycast في updateVehiclePhysics)
    vehicle = {
        chassis: chassis,
        wheels: [],
        speed: 0,
        steer: 0
    };

    const wheelPositions = [
        new Vector3(-1.1, 0.5, 1.2), new Vector3(1.1, 0.5, 1.2),
        new Vector3(-1.1, 0.5, -1.2), new Vector3(1.1, 0.5, -1.2)
    ];

    wheelPositions.forEach((pos, i) => {
        const wheel = MeshBuilder.CreateCylinder('wheel' + i, { diameter: 0.8, height: 0.4, tessellation: 16 }, scene);
        wheel.rotation.z = Math.PI / 2;
        wheel.position = pos;
        const wheelMat = new StandardMaterial('wheelMat', scene);
        wheelMat.diffuseColor = new Color3(0.1, 0.1, 0.1);
        wheel.material = wheelMat;
        vehicle.wheels.push(wheel);
        shadowGen.addShadowCaster(wheel);
    });
}

// فيزياء المركبة المخصصة (Raycast Vehicle مبسط)
function updateVehiclePhysics() {
    if (!vehicle || !vehicle.chassis.physicsAggregate) return;

    const body = vehicle.chassis.physicsAggregate.body;
    const transform = body.getTransformNode();
    const forward = transform.forward;
    const right = transform.right;
    const up = transform.up;

    // مدخلات التحكم
    let accel = 0;
    if (inputState.gas) accel = carStats.enginePower;
    if (inputState.brake) accel = -carStats.enginePower * 1.5;

    vehicle.steer = 0;
    if (inputState.left) vehicle.steer = 0.6;
    if (inputState.right) vehicle.steer = -0.6;

    // تطبيق قوة الدفع
    body.applyForce(forward.scale(accel), transform.getAbsolutePosition());

    // محاكاة التعليق والاحتكاك للعجلات (Raycast مبسط)
    vehicle.wheels.forEach((wheel, index) => {
        const isFront = index < 2;
        const localOffset = isFront ? (index === 0 ? new Vector3(-1.1, -0.5, 1.2) : new Vector3(1.1, -0.5, 1.2)) 
                                    : (index === 2 ? new Vector3(-1.1, -0.5, -1.2) : new Vector3(1.1, -0.5, -1.2));
        
        const worldPos = transform.getAbsolutePosition().add(localOffset.x * right).add(localOffset.y * up).add(localOffset.z * forward);
        
        // تحديث موقع العجلة المرئي
        wheel.position.copyFrom(worldPos);
        if (isFront) {
            wheel.rotation.y = vehicle.steer;
        }
        wheel.rotation.x += 0.2; // دوران العجلة

        // تطبيق قوة جانبية لمنع الانزلاق (محاكاة الاحتكاك)
        const lateralVelocity = body.getLinearVelocity().dot(right);
        body.applyForce(right.scale(-lateralVelocity * 10), worldPos);
        
        // قوة توجيه للعجلات الأمامية
        if (isFront && Math.abs(vehicle.steer) > 0.1) {
            body.applyForce(forward.scale(vehicle.steer * 50), worldPos);
        }
    });

    // منع الانقلاب التام (استعادة ذاتية بسيطة)
    const euler = transform.rotation;
    if (Math.abs(euler.x) > 1.5 || Math.abs(euler.z) > 1.5) {
        transform.rotation = new Vector3(0, euler.y, 0);
        body.setLinearVelocity(new Vector3(0,0,0));
        body.setAngularVelocity(new Vector3(0,0,0));
    }
}

// تحديث الكاميرا
function updateCamera() {
    if (!vehicle || !vehicle.chassis) return;
    const target = vehicle.chassis.position;
    
    if (cameraMode === 0) { // Follow
        const idealOffset = new Vector3(0, 4, -8);
        const idealLookat = new Vector3(0, 0, 5);
        // تبسيط: نجعل الكاميرا تتبع الموقع مع إزاحة
        camera.setTarget(target);
        camera.radius = 10;
        camera.alpha = vehicle.chassis.rotation.y + Math.PI; // خلف السيارة
        camera.beta = Math.PI / 2.5;
    } else if (cameraMode === 1) { // Cockpit
        camera.setTarget(target.add(vehicle.chassis.forward.scale(10)));
        camera.position = target.add(new Vector3(0, 1.5, 0.5));
    } else { // Top
        camera.setTarget(target);
        camera.position = target.add(new Vector3(0, 15, 0));
    }
}

// تحديث واجهة المستخدم
function updateHUD() {
    if (!vehicle || !vehicle.chassis.physicsAggregate) return;
    const vel = vehicle.chassis.physicsAggregate.body.getLinearVelocity();
    const speed = Math.sqrt(vel.x**2 + vel.z**2) * 3.6; // تحويل إلى km/h تقريباً
    document.getElementById('speedometer').innerText = Math.floor(speed) + ' km/h';
}

// ================== وظائف التحكم والواجهة ==================

window.startGame = function(mode) {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-hud').classList.remove('hidden');
    if (vehicle) {
        vehicle.chassis.position = new Vector3(0, 5, 0);
        vehicle.chassis.rotation = new Vector3(0, 0, 0);
        vehicle.chassis.physicsAggregate.body.setLinearVelocity(new Vector3(0,0,0));
        vehicle.chassis.physicsAggregate.body.setAngularVelocity(new Vector3(0,0,0));
    }
};

window.showMainMenu = function() {
    document.getElementById('game-hud').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
};

window.resetCar = function() {
    if (vehicle) {
        vehicle.chassis.position.y += 2;
        vehicle.chassis.rotation = new Vector3(0, vehicle.chassis.rotation.y, 0);
        vehicle.chassis.physicsAggregate.body.setLinearVelocity(new Vector3(0,0,0));
        vehicle.chassis.physicsAggregate.body.setAngularVelocity(new Vector3(0,0,0));
    }
};

window.toggleCamera = function() {
    cameraMode = (cameraMode + 1) % 3;
};

window.showImport = function() {
    document.getElementById('import-panel').classList.remove('hidden');
};

window.closeImport = function() {
    document.getElementById('import-panel').classList.add('hidden');
};

window.showGarage = function() {
    document.getElementById('garage-panel').classList.remove('hidden');
};

window.closeGarage = function() {
    document.getElementById('garage-panel').classList.add('hidden');
};

window.changeCarColor = function(color) {
    if (vehicle && vehicle.chassis.material) {
        vehicle.chassis.material.diffuseColor = Color3.FromHexString(color);
    }
};

window.upgrade = function(type) {
    if (type === 'engine') carStats.enginePower *= 1.1;
    if (type === 'suspension') carStats.suspensionStiffness *= 1.2;
    alert('تمت الترقية بنجاح!');
};

// معالجة استيراد المودات (GLB/GLTF)
document.getElementById('mod-file-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('import-status').innerText = 'جاري التحليل والبناء...';
    const url = URL.createObjectURL(file);
    
    SceneLoader.ImportMeshAsync('', '', url, scene).then((result) => {
        document.getElementById('import-status').innerText = 'تم الاستيراد بنجاح!';
        
        // محاولة اكتشاف الهيكل والعجلات تلقائياً
        let chassisMesh = null;
        const wheels = [];
        
        result.meshes.forEach(mesh => {
            if (mesh.name.toLowerCase().includes('chassis') || mesh.name.toLowerCase().includes('body')) {
                chassisMesh = mesh;
            } else if (mesh.name.toLowerCase().includes('wheel')) {
                wheels.push(mesh);
            }
        });

        // إذا لم يتم العثور على أسماء واضحة، نستخدم أكبر مجسم كهيكل
        if (!chassisMesh && result.meshes.length > 0) {
            chassisMesh = result.meshes.reduce((prev, current) => (prev.getBoundingInfo().boundingBox.extendSize.length() > current.getBoundingInfo().boundingBox.extendSize.length()) ? prev : current);
        }

        if (chassisMesh) {
            // إزالة الفيزياء القديمة إذا وجدت
            if (vehicle && vehicle.chassis.physicsAggregate) {
                vehicle.chassis.physicsAggregate.dispose();
            }
            
            // تطبيق فيزياء جديدة على المود المستورد
            chassisMesh.createDefaultPhysicsAggregate({ mass: 150, friction: 0.5 });
            vehicle.chassis = chassisMesh;
            
            // تحديث العجلات إذا تم اكتشافها
            if (wheels.length >= 4) {
                vehicle.wheels = wheels.slice(0, 4);
            }
            
            closeImport();
            startGame('free');
        } else {
            document.getElementById('import-status').innerText = 'فشل في اكتشاف هيكل المركبة.';
        }
    }).catch((err) => {
        console.error(err);
        document.getElementById('import-status').innerText = 'خطأ في تحميل الملف. تأكد من أنه GLB/GLTF صالح.';
    });
});

// ربط أزرار اللمس
const bindTouch = (id, key) => {
    const btn = document.getElementById(id);
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); inputState[key] = true; });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); inputState[key] = false; });
    btn.addEventListener('mousedown', () => inputState[key] = true);
    btn.addEventListener('mouseup', () => inputState[key] = false);
};

bindTouch('btn-gas', 'gas');
bindTouch('btn-brake', 'brake');
bindTouch('btn-left', 'left');
bindTouch('btn-right', 'right');

// ربط لوحة المفاتيح
window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = true;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = true;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = true;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = true;
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'ArrowUp') inputState.gas = false;
    if (e.key === 's' || e.key === 'ArrowDown') inputState.brake = false;
    if (e.key === 'a' || e.key === 'ArrowLeft') inputState.left = false;
    if (e.key === 'd' || e.key === 'ArrowRight') inputState.right = false;
});

// بدء التشغيل
initGame();
