import { Engine, Scene, Vector3, Color3, HemisphericLight, DirectionalLight, ShadowGenerator, ArcRotateCamera, MeshBuilder, StandardMaterial } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';

// ================== نظام تهيئة Havok المحصّن ==================
let havokPlugin = null;

async function initHavok(scene) {
    // الطريقة 1: استخدام CDN موثوق (يعمل دائماً)
    const cdnUrls = [
        'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.0/lib/esm/HavokPhysics.wasm',
        'https://unpkg.com/@babylonjs/havok@1.3.0/lib/esm/HavokPhysics.wasm',
        'https://esm.sh/@babylonjs/havok@1.3.0/lib/esm/HavokPhysics.wasm'
    ];

    for (const wasmUrl of cdnUrls) {
        try {
            console.log('🔄 محاولة تحميل Havok من:', wasmUrl);
            updateLoadingStatus('جاري تحميل محرك الفيزياء...');
            
            const havokModule = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.0/+esm');
            const HavokPhysics = havokModule.default;
            
            const havokInstance = await HavokPhysics({
                locateFile: () => wasmUrl
            });
            
            const { HavokPlugin } = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@babylonjs/core@7.15.0/Physics/+esm');
            havokPlugin = new HavokPlugin(true, havokInstance);
            scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);
            
            console.log('✅ تم تحميل Havok بنجاح');
            return true;
        } catch (err) {
            console.warn('⚠️ فشل التحميل من', wasmUrl, err);
        }
    }

    // الطريقة 2: العودة إلى الفيزياء البسيطة المدمجة (fallback)
    console.warn('⚠️ تعذر تحميل Havok، استخدام Cannon.js كبديل');
    updateLoadingStatus('تحميل محرك فيزياء احتياطي...');
    try {
        const cannonModule = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm');
        const cannon = cannonModule.default || cannonModule;
        
        const cannonPluginModule = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@babylonjs/core@7.15.0/Physics/+esm');
        const { CannonJSPlugin } = cannonPluginModule;
        havokPlugin = new CannonJSPlugin(true, 100, cannon);
        scene.enablePhysics(new Vector3(0, -9.81, 0), havokPlugin);
        return true;
    } catch (err) {
        console.error('❌ فشل كل محركات الفيزياء:', err);
        // الطريقة 3: بدون فيزياء (آخر احتياطي)
        havokPlugin = null;
        return false;
    }
}

// ================== نظام إظهار الأخطاء على الشاشة ==================
function showError(title, details) {
    document.getElementById('splash-screen').innerHTML = `
        <div class="logo-container" style="text-align:center; padding:20px;">
            <h1 style="color:#e74c3c; font-size:2rem;">⚠️ خطأ</h1>
            <h2 style="color:#fff; margin:20px 0;">${title}</h2>
            <p style="color:#aaa; font-family:monospace; background:#111; padding:15px; border-radius:5px; text-align:left; direction:ltr; font-size:0.85rem; max-height:200px; overflow:auto;">${details}</p>
            <button onclick="location.reload()" style="margin-top:20px;">إعادة المحاولة 🔄</button>
        </div>
    `;
}

function updateLoadingStatus(msg) {
    const textEl = document.querySelector('.loading-text');
    if (textEl) textEl.innerText = msg;
}

// ================== متغيرات اللعبة ==================
let engine, scene, camera, vehicle;
let inputState = { gas: false, brake: false, left: false, right: false };
let cameraMode = 0;
let carStats = { enginePower: 150, suspensionStiffness: 30, maxSpeed: 120 };

// ================== تهيئة اللعبة الرئيسية ==================
async function initGame() {
    try {
        updateLoadingStatus('تهيئة محرك الرسوميات...');
        const canvas = document.getElementById('renderCanvas');
        engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
        scene = new Scene(engine);

        // محاولة تفعيل Havok
        const physicsLoaded = await initHavok(scene);
        if (!physicsLoaded) {
            console.warn('⚠️ اللعبة ستعمل بفيزياء بسيطة (سقوط الجاذبية فقط)');
        }

        updateLoadingStatus('بناء العالم الجبلي...');
        await new Promise(r => setTimeout(r, 100));
        const shadowGen = createLighting(scene);
        createMountainWorld(scene, shadowGen);

        updateLoadingStatus('تصنيع السيارة...');
        await new Promise(r => setTimeout(r, 100));
        createDefaultVehicle(scene, shadowGen);

        updateLoadingStatus('تهيئة الكاميرا...');
        camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), scene);
        camera.attachControl(canvas, true);
        camera.lowerRadiusLimit = 3;
        camera.upperRadiusLimit = 20;

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
        
        console.log('🎮 تم تحميل اللعبة بنجاح!');
    } catch (err) {
        console.error('❌ خطأ فادح في initGame:', err);
        showError('فشل في تشغيل اللعبة', `${err.message}\n\n${err.stack}`);
    }
}

// ================== الإضاءة والبيئة ==================
function createLighting(scene) {
    const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
    hemiLight.intensity = 0.6;
    hemiLight.diffuse = new Color3(1, 0.98, 0.9);
    
    const dirLight = new DirectionalLight('dir', new Vector3(-1, -2, -1), scene);
    dirLight.position = new Vector3(20, 40, 20);
    dirLight.intensity = 1.2;
    dirLight.diffuse = new Color3(1, 0.95, 0.85);
    
    const shadowGenerator = new ShadowGenerator(1024, dirLight);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 16;
    
    return shadowGenerator;
}

// ================== العالم الجبلي ==================
function createMountainWorld(scene, shadowGen) {
    const ground = MeshBuilder.CreateGroundFromHeightMap('ground', 
        'https://assets.babylonjs.com/environments/heightMap.png', 
        { width: 200, height: 200, subdivisions: 100, minHeight: 0, maxHeight: 8 }, scene);
    
    ground.material = new StandardMaterial('groundMat', scene);
    ground.material.diffuseColor = new Color3(0.5, 0.4, 0.3);
    ground.material.specularColor = new Color3(0.1, 0.1, 0.1);
    ground.receiveShadows = true;
    
    if (havokPlugin && ground.physicsAggregate === undefined) {
        try {
            ground.createDefaultPhysicsAggregate({ mass: 0, friction: 0.8, restitution: 0.1 });
        } catch(e) { console.warn('⚠️ تعذر تطبيق فيزياء على الأرضية'); }
    }

    // صخور منتشرة
    for (let i = 0; i < 20; i++) {
        const rock = MeshBuilder.CreateSphere('rock' + i, { diameter: 2 + Math.random() * 4, segments: 8 }, scene);
        rock.position = new Vector3((Math.random() - 0.5) * 150, 8, (Math.random() - 0.5) * 150);
        rock.material = new StandardMaterial('rockMat' + i, scene);
        rock.material.diffuseColor = new Color3(0.3 + Math.random()*0.1, 0.3 + Math.random()*0.1, 0.3 + Math.random()*0.1);
        shadowGen.addShadowCaster(rock);
        
        if (havokPlugin) {
            try {
                rock.createDefaultPhysicsAggregate({ mass: 10, friction: 0.6 });
            } catch(e) { /* تجاهل */ }
        }
    }

    // طريق اسفلتي
    const road = MeshBuilder.CreatePlane('road', { width: 6, height: 180 }, scene);
    road.rotation.x = Math.PI / 2;
    road.position.y = 0.1;
    road.material = new StandardMaterial('roadMat', scene);
    road.material.diffuseColor = new Color3(0.2, 0.2, 0.2);
}

// ================== المركبة ==================
function createDefaultVehicle(scene, shadowGen) {
    const chassis = MeshBuilder.CreateBox('chassis', { width: 2, height: 1, depth: 4 }, scene);
    chassis.position.y = 2;
    chassis.material = new StandardMaterial('chassisMat', scene);
    chassis.material.diffuseColor = new Color3(0.9, 0.1, 0.1);
    shadowGen.addShadowCaster(chassis);

    // سقف
    const cabin = MeshBuilder.CreateBox('cabin', { width: 1.8, height: 0.8, depth: 2 }, scene);
    cabin.position = new Vector3(0, 1, -0.2);
    cabin.parent = chassis;
    cabin.material = new StandardMaterial('cabinMat', scene);
    cabin.material.diffuseColor = new Color3(0.7, 0.05, 0.05);
    shadowGen.addShadowCaster(cabin);

    if (havokPlugin) {
        try {
            chassis.createDefaultPhysicsAggregate({ mass: 150, friction: 0.5, restitution: 0.2 });
        } catch(e) { console.warn('⚠️ تعذر تطبيق فيزياء على الهيكل'); }
    }

    vehicle = { chassis: chassis, wheels: [], speed: 0, steer: 0 };

    const wheelPositions = [
        new Vector3(-1.1, 0.5, 1.3), new Vector3(1.1, 0.5, 1.3),
        new Vector3(-1.1, 0.5, -1.3), new Vector3(1.1, 0.5, -1.3)
    ];

    wheelPositions.forEach((pos, i) => {
        const wheel = MeshBuilder.CreateCylinder('wheel' + i, { diameter: 0.8, height: 0.4, tessellation: 16 }, scene);
        wheel.rotation.z = Math.PI / 2;
        wheel.position = pos;
        wheel.material = new StandardMaterial('wheelMat', scene);
        wheel.material.diffuseColor = new Color3(0.1, 0.1, 0.1);
        vehicle.wheels.push(wheel);
        shadowGen.addShadowCaster(wheel);
    });
}

// ================== فيزياء المركبة ==================
function updateVehiclePhysics() {
    if (!vehicle || !vehicle.chassis) return;
    const body = vehicle.chassis.physicsAggregate?.body;
    const transform = vehicle.chassis;
    
    const forward = Vector3.Forward().scale(-1).applyRotationQuaternion(transform.rotationQuaternion || transform.rotation.toQuaternion());
    const right = Vector3.Right().applyRotationQuaternion(transform.rotationQuaternion || transform.rotation.toQuaternion());

    let accel = 0;
    if (inputState.gas) accel = carStats.enginePower;
    if (inputState.brake) accel = -carStats.enginePower * 1.5;

    vehicle.steer = 0;
    if (inputState.left) vehicle.steer = 0.5;
    if (inputState.right) vehicle.steer = -0.5;

    // إذا كانت الفيزياء مفعلة، طبق القوى
    if (body) {
        body.applyForce(forward.scale(accel), transform.getAbsolutePosition());
        
        // احتكاك جانبي
        const vel = body.getLinearVelocity();
        const lateral = vel.dot(right);
        body.applyForce(right.scale(-lateral * 8), transform.getAbsolutePosition());
        
        // توجيه
        if (Math.abs(vehicle.steer) > 0.1) {
            const torque = Vector3.Up().scale(vehicle.steer * 20);
            body.applyTorque(torque);
        }
        
        // منع الانقلاب
        const rot = transform.rotationQuaternion?.toEulerAngles() || transform.rotation;
        if (Math.abs(rot.x) > 1.3 || Math.abs(rot.z) > 1.3) {
            body.setAngularVelocity(Vector3.Zero());
        }
    } else {
        // فيزياء بسيطة بدون محرك
        if (inputState.gas) {
            transform.position.addInPlace(forward.scale(0.3));
        }
        if (inputState.brake) {
            transform.position.addInPlace(forward.scale(-0.3));
        }
        if (vehicle.steer !== 0) {
            transform.rotate(Vector3.Up(), vehicle.steer * 0.05);
        }
        // جاذبية بسيطة
        transform.position.y = Math.max(transform.position.y - 0.1, 1);
    }

    // تحديث العجلات المرئية
    vehicle.wheels.forEach((wheel, i) => {
        const isFront = i < 2;
        const offsetX = (i === 0 || i === 2) ? -1.1 : 1.1;
        const offsetZ = isFront ? 1.3 : -1.3;
        
        wheel.position = transform.position.add(new Vector3(offsetX, -0.5, offsetZ));
        if (isFront) wheel.rotation.y = vehicle.steer;
        wheel.rotation.x += 0.2 + Math.abs(accel) * 0.002;
    });
}

// ================== الكاميرا ==================
function updateCamera() {
    if (!vehicle || !vehicle.chassis || !camera) return;
    const target = vehicle.chassis.position;
    
    if (cameraMode === 0) {
        camera.setTarget(target);
        camera.radius = 10;
        camera.alpha += (vehicle.chassis.rotation?.y ? -vehicle.chassis.rotation.y + Math.PI - camera.alpha : Math.PI - camera.alpha) * 0.05;
        camera.beta = Math.PI / 2.5;
    } else if (cameraMode === 1) {
        camera.position = target.add(new Vector3(0, 1.5, 0));
        camera.setTarget(target.add(Vector3.Forward().scale(-10)));
    } else {
        camera.position = target.add(new Vector3(0, 15, 0.1));
        camera.setTarget(target);
    }
}

// ================== HUD ==================
function updateHUD() {
    if (!vehicle?.chassis?.physicsAggregate?.body) return;
    const vel = vehicle.chassis.physicsAggregate.body.getLinearVelocity();
    const speed = Math.sqrt(vel.x**2 + vel.z**2) * 3.6;
    document.getElementById('speedometer').innerText = Math.floor(speed) + ' km/h';
}

// ================== واجهة المستخدم ==================
window.startGame = function(mode) {
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('game-hud').classList.remove('hidden');
    if (vehicle) {
        vehicle.chassis.position = new Vector3(0, 5, 0);
        vehicle.chassis.rotation = new Vector3(0, 0, 0);
        vehicle.chassis.physicsAggregate?.body?.setLinearVelocity?.(Vector3.Zero());
    }
};

window.showMainMenu = function() {
    document.getElementById('game-hud').classList.add('hidden');
    document.getElementById('main-menu').classList.remove('hidden');
};

window.resetCar = function() {
    if (vehicle) {
        vehicle.chassis.position = new Vector3(0, 5, 0);
        vehicle.chassis.rotation = new Vector3(0, 0, 0);
        vehicle.chassis.physicsAggregate?.body?.setLinearVelocity?.(Vector3.Zero());
        vehicle.chassis.physicsAggregate?.body?.setAngularVelocity?.(Vector3.Zero());
    }
};

window.toggleCamera = function() {
    cameraMode = (cameraMode + 1) % 3;
    console.log('📷 الكاميرا:', ['خلفية', 'قمرة القيادة', 'علوية'][cameraMode]);
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
    if (vehicle?.chassis?.material) {
        vehicle.chassis.material.diffuseColor = Color3.FromHexString(color);
    }
};

window.upgrade = function(type) {
    if (type === 'engine') carStats.enginePower *= 1.1;
    if (type === 'suspension') carStats.suspensionStiffness *= 1.2;
    alert('✅ تمت الترقية بنجاح!');
};

window.toggleSettings = function() {
    alert('⚙️ الإعدادات قيد التطوير. اضغط OK للإغلاق');
};

// ================== استيراد المودات ==================
document.getElementById('mod-file-input')?.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    document.getElementById('import-status').innerText = '⏳ جاري التحليل...';
    const url = URL.createObjectURL(file);
    
    SceneLoader.ImportMeshAsync('', '', url, scene).then((result) => {
        document.getElementById('import-status').innerText = '✅ تم الاستيراد بنجاح!';
        let chassisMesh = result.meshes.find(m => m.name.toLowerCase().includes('body') || m.name.toLowerCase().includes('chassis')) || result.meshes[0];
        if (chassisMesh && havokPlugin) {
            try { chassisMesh.createDefaultPhysicsAggregate({ mass: 150 }); } catch(e) {}
        }
        closeImport();
        startGame('free');
    }).catch((err) => {
        document.getElementById('import-status').innerText = '❌ خطأ: ' + err.message;
    });
});

// ================== أزرار التحكم ==================
const bindTouch = (id, key) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('touchstart', (e) => { e.preventDefault(); inputState[key] = true; });
    btn.addEventListener('touchend', (e) => { e.preventDefault(); inputState[key] = false; });
    btn.addEventListener('mousedown', () => inputState[key] = true);
    btn.addEventListener('mouseup', () => inputState[key] = false);
    btn.addEventListener('mouseleave', () => inputState[key] = false);
};

bindTouch('btn-gas', 'gas');
bindTouch('btn-brake', 'brake');
bindTouch('btn-left', 'left');
bindTouch('btn-right', 'right');

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

// ================== البدء ==================
initGame().catch(err => {
    console.error('💥 خطأ غير متوقع:', err);
    showError('تعذر بدء اللعبة', err.message);
});nction(color) {
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
