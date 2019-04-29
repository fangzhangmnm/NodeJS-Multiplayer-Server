//@ts-check
if(io==null){
    var io=require("socket.io-client");
}
class ClientSide{
    constructor(url){
        this.id=null;
        this.key=null;
        this.roomId=null;

        this.entityLocalIdCounter=0;
        this.updatingEntityCount=0;
        this.entitiesLocalId=new Map();
        this.entitiesNetId=new Map();
        this.entityUploadList=new Set();

        this.pSmoothTime=0.1;
        this.qSmoothTime=0.1;
        this.vSmoothTime=0.1;
        this.maxExtrapolateTime=1;
        this.maxVEstimate=100;

        this.onConnectionHandler=null;
        this.onRoomReadyHandler=null;
        this.createEntityHandler=null;
        this.removeEntityHandler=null;

        //this.lastSyncServerTimeMS=null;
        //this.lastSyncLocalTimeMS=null;
        this.localToServerTimeBiasMS=0;//本地的钟超出服务器钟的部分
        this.timeBiasAvgWindow=10;
        this.doubleDelayMS=null;
        this.maxDoubleDelayMS=2000;
        this.roomStartServerTimeMS=null;

        console.log(`connecting to ${url}...`);
        this.socket=io(url);
        var client=this;
        //TODO myPing
        this.socket.on("ping1",(info)=>{
            client.socket.emit("ping2",{t0:info.t0,t1:Date.now()});
        })
        this.socket.on("ping3",(info)=>{
            var t3=Date.now();
            client.doubleDelayMS=Math.max(0,Math.min(t3-info.t1,client.maxDoubleDelayMS));
            var biasMS=t3-(info.t2+client.doubleDelayMS/2);//local-server
            client.localToServerTimeBiasMS=client.localToServerTimeBiasMS*(1-1/client.timeBiasAvgWindow)+biasMS*1/client.timeBiasAvgWindow;
            
            //console.log(`server ping: ${client.doubleDelayMS} ms clientBias ${client.localToServerTimeBiasMS}`);
        });
        this.socket.on("connect",()=>{
            console.log("hello")
            client.socket.emit("login",{
                id:this.id,
                key:this.key,
                t1:Date.now()
            })
        });
        this.socket.on("disconnect",()=>{
            //TODO
            console.log("server disconnected");
        });
        this.socket.on("login",(info)=>{
            //TODO
            console.log(info)
            var t3=Date.now();
            client.doubleDelayMS=t3-info.t1;
            client.doubleDelayMS=Math.max(0,Math.min(client.doubleDelayMS,client.maxDoubleDelayMS));
            var biasMS=t3-(info.t2+client.doubleDelayMS/2);//local-server
            client.localToServerTimeBiasMS=biasMS;
            //console.log(`server ping: ${client.doubleDelayMS} ms clientBias ${client.localToServerTimeBiasMS}`);
            
            if(client.id==null)
                console.log("connection established");
            else{
                console.log("connection restored");
                console.log("clear downloaded entities");
                clearDownloadedEntitiesAndResetUploadEntities();
            }
            if(client.id!=info.id){
                if(client.id!=null)
                    console.log("wrong key. assign new id");
            }else{
                console.log("login successfully");
                
            }
            client.id=info.id;
            client.key=info.key;
            console.log("Your id is: ",client.id);
            if(client.onConnectionHandler!=null)
                client.onConnectionHandler();
        });
        this.socket.on("newEntities",(infos)=>{
            var netIds=[];
            infos.forEach(info => {
                //console.log(info)
                var e;
                if(client.entitiesNetId.has(info.nid)){
                    //本地创造的，还没从网上更新回来之前，是不知道netId的。
                    console.error("ERROR newEntities: an entity with same netId exists: ",info.nid);
                }else{
                    if(client.id==info.a && client.entitiesLocalId.has(info.lid)){
                            //第一种情况，已经本地创造过了
                            e=client.entitiesLocalId.get(info.lid);
                            e.netId=info.nid;
                            e.author=info.a;
                            client.entitiesNetId.set(e.netId,e);
                            //if(e.author==client.id)
                                client.updatingEntityCount+=1;
                            console.log(`entity L${e.localId} accepted, netId:`,e.netId);
                    }else{
                        //第二种情况，已经网上下载的。注意可能所有者还是你
                        e=new EntityClientSide(client.entityLocalIdCounter++,info.p,info.q,info.t,info.s);
                        //console.log(info)
                        e.netId=info.nid;
                        e.author=info.a;
                        client.entitiesLocalId.set(e.localId,e);
                        client.entitiesNetId.set(e.netId,e);
                        if(e.author==client.id)
                            client.updatingEntityCount+=1;
                        if(client.createEntityHandler!=null)
                            this.createEntityHandler(e.localId,e.author==this.id,e.p,e.q,e.staticData);
                        netIds.push(e.netId);
                    }
                }
            });
            if(netIds.length>0)
                console.log("downloaded remote entities:",netIds);
        });
        this.socket.on("removeEntities",(netIds)=>{
            netIds.forEach(netId => {
                var e=client.entitiesNetId.get(netId);
                if(e==null)
                    console.assert("entity should not be removed before networked remove command");
                else{
                    client.entitiesNetId.delete(e.netId);
                    client.entitiesLocalId.delete(e.localId);
                    if(client.removeEntityHandler!=null)
                        client.removeEntityHandler(e.localId);
                    if(e.author==client.id){
                        client.updatingEntityCount-=1;
                    }
                    console.log("removed entity locally netId:",e.netId);
                }
            });
        });
        this.socket.on("roomReady",(info)=>{
            client.roomId=info.roomId;
            client.roomStartServerTimeMS=info.startTimeMS;
            console.log("Joined room id: ",client.roomId);
            uploadListedEntities();
            client.uploadRemoveFlags();
            if(client.onRoomReadyHandler!=null)
                client.onRoomReadyHandler();
        });
        this.socket.on("b",(bufferArray)=>{
            //必须先转成Uint8Array，不然连长度都不一样
            var buffer=new Uint8Array(bufferArray).buffer;
            var w=EntityClientSide.getDynamicSize();
            var n=buffer.byteLength/(4+4*w);
            var nidArray=new Int32Array(buffer,0,n);
            var dArray=new Float32Array(buffer,4*n,w*n);
            var i=0;
            nidArray.forEach(netId=>{
                var e=client.entitiesNetId.get(netId);
                if(e==null)
                    console.log("received dynamics of unexist entity netId: ",e.netId);
                else{
                    if(e.author!=client.id){
                        e.unpackDynamicAndUpdateVelocity(dArray,w*i,this.vSmoothTime,this.maxVEstimate);
                    }
                }
                i+=1;
            })
        });
        var clearDownloadedEntitiesAndResetUploadEntities=function(){
            var toRemove=[];
            client.entityUploadList.clear();
            client.entitiesLocalId.forEach((entity,localId)=>{
                if(entity.author!=client.id)
                    toRemove.push({localId:entity.localId,netId:entity.netId});
                else
                    client.entityUploadList.add(entity.localId);
            });
            toRemove.forEach((info)=>{
                if(client.removeEntityHandler!=null)
                    client.removeEntityHandler(info.localId);
                client.entitiesLocalId.delete(info.localId);
                client.entitiesNetId.delete(info.netId);
            });
            client.entitiesLocalId.forEach((entity,localId)=>{
                if(client.removeEntityHandler!=null)
                    client.removeEntityHandler(localId);
            });
        }
        var uploadListedEntities=function(){
            console.log("uploading pre-created entities");
            var infos=[];
            var currentRoomTime=client.getRoomTime();
            client.entityUploadList.forEach(lid => {
                var e=client.getEntity(lid);
                infos.push({lid:e.localId,p:e.p,q:e.q,t:currentRoomTime,s:e.staticData});
            });
            client.entityUploadList.clear();
            if(infos.length>0)
                client.socket.emit("createEntities",infos);
        }
    }
    getServerTimeMS(){
        return Date.now()-this.localToServerTimeBiasMS;
    }
    getRoomTime(){
        return (this.getServerTimeMS()-this.roomStartServerTimeMS)/1000;
    }
    createEntityNow(p,q,staticData){
        var e=new EntityClientSide(this.entityLocalIdCounter++,p,q,this.getRoomTime(),staticData);
        e.author=this.id;
        this.entitiesLocalId.set(e.localId,e);
        console.log(`entity L${e.localId} created locally`);
        var currentRoomTime=this.getRoomTime();
        if(this.roomId!=null){
            this.socket.emit("createEntities",[{lid:e.localId,p:e.p,q:e.q,t:currentRoomTime,s:e.staticData}]);
        }else{
            this.entityUploadList.add(e.localId);
        }
        if(this.createEntityHandler!=null)
            this.createEntityHandler(e.localId,e.author==this.id,e.p,e.q,e.staticData);
        return e.localId;//不给你引用，只给你句柄
    }
    removeEntityRetarted(localId){
        var e=this.entitiesLocalId.get(localId);
        if(e!=null && e.author==this.id){
            console.log("Set remove flag to entity NetId:",e.netId);
            e.removeFlag=true;
        }
    }
    joinRoom(roomName){
        this.socket.emit("joinRoom",roomName);
    }
    onRoomReady(handler){this.onRoomReadyHandler=handler;}
    uploadEntityDynamics(){
        var n=this.updatingEntityCount;
        var w=EntityClientSide.getDynamicSize();
        var i=0;
        var bufferArray=new Uint8Array(n*(4+4*w));
        var buffer=bufferArray.buffer;
        var nidArray=new Int32Array(buffer,0,n);
        var dArray=new Float32Array(buffer,4*n,w*n);
        var currentRoomTime=this.getRoomTime();
        var client=this;
        this.entitiesNetId.forEach((entity,netId)=>{
            if(entity.author==client.id){
                if(i>=n)
                    console.assert("wrong updatingEntityCount")
                else{
                    nidArray[i]=entity.netId;
                    entity.packDynamic(dArray,w*i,currentRoomTime);
                    i+=1;
                }
            }
        });
        this.socket.emit("d",buffer);
        //console.log(`Uploaded ${n} entity dynamics packed in ${buffer.byteLength} bytes`);
    }
    uploadRemoveFlags(){
        //必须在uploadEntityDynamics之后调用
        var toRemoveNetIds=[]
        var client=this;
        this.entitiesNetId.forEach((entity,netId)=>{
            if(entity.removeFlag && entity.author==client.id){
                if(entity.netId==null)
                    console.assert("entities in entitiesNetworkId should have valid netId");
                else
                    toRemoveNetIds.push(entity.netId);
            }
        });
        if(toRemoveNetIds.length>0)
            this.socket.emit("removeEntities",toRemoveNetIds);
    }
    updateExtrapolate(smoothDt){
        var currentRoomTime=this.getRoomTime();
        var client=this;
        var pSmoothFactor=Math.min(1,smoothDt/client.pSmoothTime);
        var qSmoothFactor=Math.min(1,smoothDt/client.qSmoothTime);
        this.entitiesNetId.forEach((entity,netId)=>{
            if(entity.author!=client.id){
                entity.updateDynamic(currentRoomTime,pSmoothFactor,qSmoothFactor,client.maxExtrapolateTime,client.maxVEstimate);
            }
        });
    }
    onConnection(handler){this.onConnectionHandler=handler;}
    getEntity(localId){return this.entitiesLocalId.get(localId);}
}
class EntityClientSide{
    constructor(localId,p,q,t,staticData){
        this.localId=localId;
        this.netId=null;
        this.author=null;
        this.p={x:p.x,y:p.y,z:p.z};
        this.q={x:q.x,y:q.y,z:q.z,w:q.w};
        if(!isFinite(q.w))console.assert("EntityClientSide q.w NaN");
        if(q.w<0)console.assert("EntityClientSide q.w<0");
        this.v={x:0,y:0,z:0};
        this.p0={x:p.x,y:p.y,z:p.z};
        this.q0={x:q.x,y:q.y,z:q.z,w:q.w};
        this.t0=t;
        this.removeFlag=false;
        this.staticData=staticData;
    }
    static getDynamicSize(){return 7;}
    packDynamic(array,i,t){
        var p=this.p,q=this.q;
        array[i+0]=t;
        array[i+1]=p.x;
        array[i+2]=p.y;
        array[i+3]=p.z;
        array[i+4]=q.x;
        array[i+5]=q.y;
        array[i+6]=q.z;
    }
    unpackDynamicAndUpdateVelocity(array,i,vSmoothTime,maxVEstimate){
        var nt=array[i+0];
        if(nt<=this.t0)return;
        var Dt=Math.max(0.001,nt-this.t0);this.t0=nt;
        var np={},nv={};
        np.x=array[i+1];
        np.y=array[i+2];
        np.z=array[i+3];
        nv.x=(np.x-this.p0.x)/Dt;this.p0.x=np.x;
        nv.y=(np.y-this.p0.y)/Dt;this.p0.y=np.y;
        nv.z=(np.z-this.p0.z)/Dt;this.p0.z=np.z;
        if(nv.x*nv.x+nv.y*nv.y+nv.z*nv.z<maxVEstimate*maxVEstimate)//TODO
            EntityClientSide.lerp(this.v,this.v,nv,Math.min(1,Dt/vSmoothTime));
        var q=this.q0;
        q.x=array[i+4];
        q.y=array[i+5];
        q.z=array[i+6];
        q.w=Math.sqrt(Math.max(0,1-q.x*q.x-q.y*q.y-q.z*q.z));
        if(q.w<0)console.assert("EntityClientSide q.w<0");
        
    }
    updateDynamic(t,pSmoothFactor,qSmoothFactor,maxExtrapolateTime){
        var Dt=Math.max(0,t-this.t0);
        if(Dt>maxExtrapolateTime)Dt=maxExtrapolateTime*(2-maxExtrapolateTime/Dt);
        var np={};
        //console.log(this.p0.x,this.v.x,Dt,this.p0.x+Dt*this.v.x)
        np.x=this.p0.x+Dt*this.v.x;
        np.y=this.p0.y+Dt*this.v.y;
        np.z=this.p0.z+Dt*this.v.z;
        EntityClientSide.lerp(this.p,this.p,np,Math.max(0,Math.min(1,pSmoothFactor)));
        EntityClientSide.slerp(this.q,this.q,this.q0,Math.max(0,Math.min(qSmoothFactor)));
    }
    static lerp(p,p0,p1,t){
        p.x=p0.x*(1-t)+p1.x*t;
        p.y=p0.y*(1-t)+p1.y*t;
        p.z=p0.z*(1-t)+p1.z*t;
    }
    static slerp(q,q0,q1,t) {
        //from https://github.com/mrdoob/three.js/
        var x0=q0.x,y0=q0.y,z0=q0.z,w0=q0.w;
        var x1=q1.x,y1=q1.y,z1=q1.z,w1=q1.w;
        if ( w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1 ) {
            var s = 1 - t,
                cos = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1,
                dir = ( cos >= 0 ? 1 : - 1 ),
                sqrSin = 1 - cos * cos;
            // Skip the Slerp for tiny steps to avoid numeric problems:
            if ( sqrSin > Number.EPSILON ) {
                var sin = Math.sqrt( sqrSin ),
                    len = Math.atan2( sin, cos * dir );
                s = Math.sin( s * len ) / sin;
                t = Math.sin( t * len ) / sin;
            }
            var tDir = t * dir;
            x0 = x0 * s + x1 * tDir;
            y0 = y0 * s + y1 * tDir;
            z0 = z0 * s + z1 * tDir;
            w0 = w0 * s + w1 * tDir;
            // Normalize in case we just did a lerp:
            if ( s === 1 - t ) {
                var f = 1 / Math.sqrt( x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0 );
                x0 *= f;y0 *= f;z0 *= f;w0 *= f;
            }
        }
        q.x=x0;q.y=y0;q.z=z0;q.w=w0;
    }
}

class ThreeJSClientUpdator{
    constructor(client,uploadInterval){
        this.client=client;
        this.threeJSObjects=new Map();
        this.threeJSObjectsReverse=new Map();
        this.createHandler=null;
        this.removeHandler=null;
        var updator=this;
        client.createEntityHandler=(localId,isAuthor,p,q,staticData)=>{
            console.log("createEntityHandler")
            var e=updator.client.getEntity(localId);
            var threeJSObject=updator.createHandler(localId,isAuthor,p,q,staticData);
            updator.threeJSObjects.set(localId,threeJSObject);
            updator.threeJSObjectsReverse.set(threeJSObject,localId);
        };
        client.removeEntityHandler=(localId)=>{
            var threeJSObject=this.threeJSObjects.get(localId)
            updator.removeHandler(threeJSObject);
            updator.threeJSObjects.delete(localId);
            updator.threeJSObjectsReverse.delete(threeJSObject);
        };
        client.onConnection(()=>{
            client.joinRoom("default");
        });
        client.onRoomReady(()=>{
            setInterval(()=>{
                client.uploadEntityDynamics();
                client.uploadRemoveFlags();
            },uploadInterval*1000);
        })
    }
    create(p,q,staticData){
        var localId=this.client.createEntityNow(p,q,staticData);
        return this.threeJSObjects.get(localId);
    }
    remove(threeJSObject){
        this.client.removeEntityRetarted(this.threeJSObjectsReverse.get(threeJSObject));
    }
    update(dt){
        this.client.updateExtrapolate(Math.max(0.002,dt));
        var updator=this;
        var currentRoomTime=updator.client.getRoomTime();
        this.threeJSObjects.forEach((threeJSObject,localId)=>{
            var e=updator.client.getEntity(localId);
            if(e.author==updator.client.id){
                e.p.x=threeJSObject.position.x;
                e.p.y=threeJSObject.position.y;
                e.p.z=threeJSObject.position.z;
                e.q.x=threeJSObject.quaternion.x;
                e.q.y=threeJSObject.quaternion.y;
                e.q.z=threeJSObject.quaternion.z;
                e.q.w=threeJSObject.quaternion.w;
            }else{
                threeJSObject.position.copy(e.p);
                threeJSObject.quaternion.copy(e.q);
            }
        })
    }
}

if(false){
    var myClient=new ClientSide("ws://localhost:9999");
    var handle=myClient.createEntityNow({p:{x:0,y:0,z:0},q:{x:0,y:0,z:0,w:0},v:{x:0,y:0,z:0}},{name:"entity1"});
    myClient.onConnection(()=>{
        myClient.joinRoom("default");
        myClient.socket.emit("int",233);
    });
    myClient.onRoomReady(()=>{
        setInterval(()=>{
            myClient.getEntity(handle).dynamicData.p.x=Math.cos(myClient.getRoomTime());
            myClient.uploadEntityDynamics();
            myClient.uploadRemoveFlags();
            var e1=myClient.getEntity(0),e2=myClient.getEntity(1);
            if(e1!=null && e2!=null){
                console.log(e1.dynamicData.p.x,e2.dynamicData.p.x);
            }else if(e1!=null){
                console.log(e1.dynamicData.p.x);
            }
        },100);
    });
}

module.exports={
    ClientSide:ClientSide,
    EntityClientSide:EntityClientSide,
    //ThreeJSClientUpdator:ThreeJSClientUpdator
}
