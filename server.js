//@ts-check
class Entity{
    constructor(netId,localId,author,p,q,t,staticData){
        this.netId=netId;
        this.localId=localId;
        this.author=author;
        //console.log(dynamicData);
        this.p=p;
        this.q=q;
        this.t=t;
        this.staticData=staticData;
    }
    static getDynamicSize(){return 7;}
    packDynamic(array,i){
        var p=this.p,q=this.q;
        array[i+0]=this.t;
        array[i+1]=p.x;
        array[i+2]=p.y;
        array[i+3]=p.z;
        array[i+4]=q.x;
        array[i+5]=q.y;
        array[i+6]=q.z;
    }
    unpackDynamic(array,i){
        var p=this.p,q=this.q;
        this.t=array[i+0];
        p.x=array[i+1];
        p.y=array[i+2];
        p.z=array[i+3];
        q.x=array[i+4];
        q.y=array[i+5];
        q.z=array[i+6];
        q.w=Math.sqrt(Math.max(0,1-q.x*q.x-q.y*q.y-q.z*q.z));
    }
}
class Client{
    constructor(id,key,connection,server){
        this.id=id;this.key=key;this.connection=connection;this.server=server;
        this.lastPingMS=server.getServerTimeMS();
        this.waitForPing=false;
        this.doubleDelayMS=0;//TODO
        this.roomId=null;
    }
    leaveAnyRoom(){
        if(this.server.rooms.has(this.roomId))
            this.server.rooms.get(this.roomId).leaveClientAndRemoveEntities(this);
        this.roomId=null;
    }
    joinRoom(room){
        this.leaveAnyRoom();
        this.roomId=room.id;
        if(this.server.rooms.has(room.id))
            this.server.rooms.get(room.id).joinClient(this);
    }
}
class Room{
    constructor(id,name,server){
        this.id=id;
        this.name=name;
        this.server=server;
        this.entityIdCounter=0;
        this.entities=new Map();
        this.joinedClients=new Map();
        this.startTimeMS=this.server.getServerTimeMS();
    }
    joinClient(client){
        var room=this;
        this.joinedClients.set(client.id,client);
        console.log(`${this.name}: player ${client.id} joined the room`);
        client.connection.emit("roomReady",{
            roomId:this.id,
            startTimeMS:this.startTimeMS
        });
        var infos=[];
        this.entities.forEach((entity,netId)=>{
            infos.push({
                nid:entity.netId,
                lid:entity.localId,
                a:entity.author,
                p:entity.p,
                q:entity.q,
                t:entity.t,
                s:entity.staticData
            });
        });
        client.connection.emit("newEntities",infos);
    }
    getRoomTime(){
        return (this.server.getServerTimeMS()-this.startTimeMS)/1000;
    }
    leaveClientAndRemoveEntities(client){
        if(this.joinedClients.has(client.id)){
            var toRemove=[];
            this.entities.forEach((entity,netId)=>{
                if(entity.author==client.id)
                    toRemove.push(entity.netId);
            })
            this.removeEntities(toRemove,client.id);
            console.log(`${this.name}: client ${client.id} leave the room`);
            this.joinedClients.delete(client.id);
        }
    }
    createEntity(localId,author,p,q,t,staticData){
        //TODO check dynamicData format
        var entity=new Entity(this.entityIdCounter++,localId,author,p,q,t,staticData);
        this.entities.set(entity.netId,entity);
        console.log(`${this.name}: client ${author} createEntity netId:`,entity.netId);
        this.joinedClients.forEach((client,clientId)=>{
            client.connection.emit("newEntities",[{
                nid:entity.netId,
                lid:entity.localId,
                a:entity.author,
                p:entity.p,
                q:entity.q,
                t:entity.t,
                s:entity.staticData
            }]);
        });
    }
    removeEntities(netIds,author){
        var room=this;
        var actuallyRemoved=[];
        netIds.forEach(netId => {
            var e=room.entities.get(netId);
            if(e==null)
                console.log(`${this.name}: client ${author} try removing unexist entity netId:`,netId);
            else if(e.author!=author && e.author!=null)
                console.log(`${this.name}: client ${author} try removing unauthorized entity netId:`,netId);
            else{
                room.entities.delete(netId);
                actuallyRemoved.push(netId);
            }
        });
        this.joinedClients.forEach((client,clientId)=>{
            client.connection.emit("removeEntities",actuallyRemoved);
        });
        console.log(`${this.name}: removed entities netId:`,actuallyRemoved);
    }
    updateDynamics(nidArray,dArray,n,w,author){
        var room=this;
        var i=0;
        nidArray.forEach(netId => {
            var e=room.entities.get(netId);
            if(e==null)
                console.log(`${this.name}: client ${author} try updating unexist entity netId:`,netId);
            else if(e.author!=author && e.author!=null)
                console.log(`${this.name}: client ${author} try updating unauthorized entity netId:`,netId);
            else{
                //console.log(`${this.name}: client ${author} updated entity netId:`,netId);
                e.unpackDynamic(dArray,w*i);
            }
            i+=1;
        });

    }
    broadcastImmediately(nidArray,dArray,n0,w,author){
        var room=this;
        var n1=0;
        nidArray.forEach(netId => {
            var e=room.entities.get(netId);
            if(e!=null && e.author==author)
                n1+=1;
        });
        if(n1>0){
            var i=0;
            var bufferArray1=new Uint8Array(n1*(4+4*w));
            var buffer1=bufferArray1.buffer;
            var nidArray1=new Int32Array(buffer1,0,n1);
            var dArray1=new Float32Array(buffer1,4*n1,w*n1);
            this.entities.forEach((entity,netId)=>{
                if(entity.author==author){
                    nidArray1[i]=entity.netId;
                    entity.packDynamic(dArray1,w*i);
                    i+=1;
                }
            });
            this.joinedClients.forEach((client,clientId)=>{
                client.connection.emit("b",buffer1);
            });
        }
    }
    broadcastDynamics(){
        var n=this.entities.size;
        if(n>0){
            var w=Entity.getDynamicSize();
            var i=0;
            var bufferArray=new Uint8Array(n*(4+4*w));
            var buffer=bufferArray.buffer;
            var nidArray=new Int32Array(buffer,0,n);
            var dArray=new Float32Array(buffer,4*n,w*n);
            var room=this;
            this.entities.forEach((entity,netId)=>{
                nidArray[i]=entity.netId;
                entity.packDynamic(dArray,w*i);
                i+=1;
            });
            //console.log(nidArray,dArray);
            this.joinedClients.forEach((client,clientId)=>{
                client.connection.emit("b",buffer);
            });
        //console.log(`${this.name}: Broadcasted ${n} entity dynamics to ${this.joinedClients.size} clients packed in ${buffer.byteLength} bytes`);
        }
    }
}
class Server{
    constructor(){

        this.clientIdCounter=0;
        this.clients=new Map();
        this.roomIdCounter=0;
        this.rooms=new Map();
        this.roomNames=new Map();
        this.broadcastInterval=0.05;
        this.broadcastImmediately=true;
        this.pingInterval=1;
        this.autoKickTime=10;
        this.app=require('http').createServer((req,res)=>{res.writeHead(404);});
        this.io=require("socket.io")(this.app);
        var server=this;
        this.io.on("connection",(socket)=>{
            console.log("new connection established");
            socket.on("login",(info)=>{
                console.log("login")
                var client=null;
                if(info.id!=null && server.clients.has(info.id) && server.clients.get(info.id).key==info.key){
                    client=server.clients.get(info.id);
                    console.log(`user ${client.id} reconnected`);
                }else{
                    if(info.id!=null)
                        console.log(`someone try login user ${info.id} with wrong key`);
                    client=server.createClient(socket);
                    console.log(`user ${client.id} connected`);
                }
                socket.emit("login",{
                    id:client.id,
                    key:client.key,
                    t1:info.t1,
                    t2:server.getServerTimeMS()
                });
                socket.on("disconnect",()=>{
                    console.log(`user ${client.id} disconnected manually`);
                    server.removeClient(client);
                });
                socket.on("logoff",()=>{
                    console.log(`user ${client.id} log off`);
                    server.removeClient(client);
                })
                socket.on("int",(i)=>{
                    console.log("int ",i);
                });
                socket.on("joinRoom",(roomName)=>{
                    var room=server.roomNames.get(roomName);
                    if(room!=null){
                        client.joinRoom(room);
                    }
                });
                socket.on("createEntities",(infos)=>{
                    //TODO check type
                    var room=server.rooms.get(client.roomId);
                    if(room!=null){
                        infos.forEach(info => {
                            if(!checkEntity(info))
                                console.log(`user ${client.id} uploaded illegal creatEntity data: `);
                            else
                                room.createEntity(info.lid,client.id,info.p,info.q,info.t,info.s);
                        });
                    }
                });
                socket.on("removeEntities",(netIds)=>{
                    var room=server.rooms.get(client.roomId);
                    if(room!=null){
                        room.removeEntities(netIds,client.id);
                    }
                });
                socket.on("d",(bufferArray)=>{
                    //必须先转成Uint8Array，不然连长度都不一样
                    var buffer=new Uint8Array(bufferArray).buffer;
                    var w=Entity.getDynamicSize();
                    var n=buffer.byteLength/(4+4*w);
                    var nidArray=new Int32Array(buffer,0,n);
                    var dArray=new Float32Array(buffer,4*n,w*n);
                    var room=server.rooms.get(client.roomId);
                    if(room!=null){
                        if(server.broadcastImmediately)
                            room.broadcastImmediately(nidArray,dArray,n,w,client.id);
                        room.updateDynamics(nidArray,dArray,n,w,client.id);//仍然需要存储状态以供新人查询
                    }
                });
                
                socket.on("ping2",(info)=>{
                    var grossTimeMS=server.getServerTimeMS();
                    client.waitForPing=false;
                    client.doubleDelayMS=grossTimeMS-info.t0;
                    client.connection.emit("ping3",{t0:info.t0,t1:info.t1,t2:grossTimeMS});
                    console.log(`Ping client ${client.id}: ${client.doubleDelayMS} ms`);
                });
            });
        });
        var checkEntity=function(info){
            if(!Number.isInteger(info.lid))return false;
            if(info.p==null||info.q==null||info.s==null)return false;
            if(!isFinite(info.p.x)||!isFinite(info.p.y)||!isFinite(info.p.z))return false;
            if(!isFinite(info.q.x)||!isFinite(info.q.y)||!isFinite(info.q.z)||!isFinite(info.q.w))return false;
            if(info.q.w<0)return false;
            return true;
        }
    }
    getServerTimeMS(){
        return Date.now();
    }
    createClient(connection){
        var client=new Client(this.clientIdCounter++,Math.floor(Math.random()*100000),connection,this);
        this.clients.set(client.id,client);
        return client;
    }
    removeClient(client){
        client.leaveAnyRoom();
        this.clients.delete(client.id);
    }
    createRoom(name){
        if(this.roomNames.has(name))
            return;
        var room=new Room(this.roomIdCounter++,name,this);
        this.rooms.set(room.id,room);
        this.roomNames.set(room.name,room);
        return room;
    }
    start(port){
        this.app.listen(port);
        var server=this;
        if(!server.broadcastImmediately && server.broadcastInterval>0)
            setInterval(()=>{
                server.rooms.forEach((room,roomId)=>{
                    room.broadcastDynamics();
                });
            },1000*server.broadcastInterval);
        if(server.pingInterval>0){
            setInterval(()=>{
                var grossTimeMS=server.getServerTimeMS();
                server.clients.forEach((client,clientId)=>{
                    if(client.waitForPing){
                        if((grossTimeMS-client.lastPingMS)/1000>server.autoKickTime){
                            //console.log(`user ${client.id} lose response, disconnect`);
                            server.removeClient(client);
                        }
                    }else{
                        client.connection.emit("ping1",{t0:grossTimeMS});
                        client.waitForPing=true;
                        client.lastPingMS=grossTimeMS;
                    }
                });
                
            },1000*server.pingInterval);
        }
        console.log("start listening");
    }
}
var myServer=new Server();
myServer.broadcastInterval=0.02;
myServer.broadcastImmediately=true;
//myServer.pingInterval=2;
//myServer.autoKickTime=2;
//myServer.broadcastInterval=0.4;
myServer.createRoom("default");
myServer.start(9999);
