/**
 * 
 * @Vlad@ Chernenko 23.07.-1
 * 
 * 
 *   To test different type of txs
 *   BTW,I've noticed that sequence:
 *   <payload+chain+chainNonce+SID+GUID+localNonce>
 *
 *   looks like OSI packets.Basically-nessesary data for node is SID+GUID+localnonce,
 *   while data requiered by specific chain is payload+chain+chainNonce
 *
 * 
 */

import tbls from '../../KLY_Utils/signatures/threshold/tbls.js'
import bls from '../../KLY_Utils/signatures/multisig/bls.js'
import {ED25519_SIGN_DATA} from '../../KLY_Utils/utils.js'
import {Transaction} from '@ethereumjs/tx'
import {Common} from '@ethereumjs/common'
import {hash} from 'blake3-wasm'
import fetch from 'node-fetch'
import Web3 from 'web3'



//___________________________________________ CONSTANTS POOL ___________________________________________


const web3 = new Web3('http://localhost:7331')

const SYMBIOTE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'//chain on which you wanna send tx

const WORKFLOW_VERSION = 0

const FEE = 5

const TX_TYPES = {

    TX:'TX', // default address <=> address tx
    CONTRACT_DEPLOY:'CONTRACT_DEPLOY',
    CONTRACT_CALL:'CONTRACT_CALL',
    EVM_CALL:'EVM_CALL',
    MIGRATE_BETWEEN_ENV:'MIGRATE_BETWEEN_ENV'

}

const SIG_TYPES = {
    
    DEFAULT:'D',                    // Default ed25519
    TBLS:'T',                       // TBLS(threshold sig)
    POST_QUANTUM_DIL:'P/D',         // Post-quantum Dilithium(2/3/5,2 used by default)
    POST_QUANTUM_BLISS:'P/B',       // Post-quantum BLISS
    MULTISIG:'M'                    // Multisig BLS
}

// KLY-EVM
const common = Common.custom({name:'KLYNTAR',networkId:7331,chainId:7331},'merge')



//___________________________________________ TEST ACCOUNTS ___________________________________________


// BLS multisig
let user0 = {

    prv:"af837c459929895651315e878f4917c7622daeb522086ec95cfe64fed2496867",
    
    pub:"7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta"

}


// Ed25519
let user1 = {

    mnemonic: 'already mad depart absorb song chicken leaf huge goat sock mixture neutral',
    bip44Path: "m/44'/7331'/0'/0'",
    pub: '9FUM4c6w52g7WYbjMDUeUE4SbCG7WoTyt9GQJVn7dZv2',
    prv: 'MC4CAQAwBQYDK2VwBCIEIM6KRecE2f1azYPhPhv2pTn/9rZCtbk1o+KALSHuJ3U9'
}


// Ed25519
let user2 = {

    mnemonic: 'pitch escape crystal tomato another what cake ecology duck ladder abandon until',
    bip44Path: "m/44'/7331'/0'/0'",
    pub: 'AinYkbnYajt8EKYGAypDfQrCt5MydWcpfXDtNbTHgBVB',
    prv: 'MC4CAQAwBQYDK2VwBCIEIIvD/+oVkGdPQTj1ZzHpGOaRjCr+W223zPKIJoN+3FLn'
  
}


let user3 = {
    prv: '452a1b608c8d7cba6948f08310fcb5948789ce919c1a97b6e00419855bfe5d93',
    pub: '6arvhqRSs4hKXTSMXtxr9xd2H7phECuZ5Tp6ujgq15eDETgURQ9sX2jYUfTrgoT9ki'
}

// For 2/3 tests, but you can use anyhow you want. See https://mastering.klyntar.org/beginning/cryptography/multi-threshold-aggregated-signatures

let tblsAccounts = {

    A:{
    
        vv:["79309fde56bf1e0420408b79b9adb8b675b85eddb78b675d66b1931106a3d113f34d23257c912ee1800fcc31290e525bfbaf5d18a51eabc7daefc3ff8d183d17","67c2572d5b5e9be849917ba16a2152d70dff21094915ccf03969acbc0046870ece2fe2d9afbdd6dc5b65e2e528ee702a3343de6caf3b25f0f9c571fcfd55d084"],
        shares:['f77ffec138a41033c3f278774685a53fa4f49687365d788c0efd671f29359703','f5b187d48cd56e9680985f5f0a6f7744bef11092a142bbbc0d5f0c4c92ed0a02','48f13b18936fabb681d7ed21bd0e747e9553b3777547795e9ad878734197631a'],
        id:'4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785451a'
    },
    

    B:{

        vv:["0af3b5585e92422fd02d0370043e193f258896df63b4fcf37f5323c8d0545b00e67f1b3b728751ef2dabc3378959376b83edec5d0b788c367edb195cc9bca402","29480aacb9fd7c9fc02f2f201cf2958b1bac764f1b1d9b4ad0c4f24c981a891db271723d076eb06b0a5c6bddf758b3fc9ade4542628f583796fa55b5855bf194"],
        shares:['1bfe78127fb2e4ee5eab8d0875aef9c49606535825fbb2619edb29ccd1a93508','ba706c61ab4be0b619b523021e79afddf21e124ecca08c1af4d057b3b6dd7213','a97319f37cdf2833a996334952eb73f8903260574d1ef549007a0d2de1ccb41c'],
        id:'dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d906'

    },
    
    C:{

        vv:["0e4b8473bfe882f056d3ce4de2550b2f3415ec83b04fc9580656e74e308fa207730a126afe151feef1b505b3a00bc5939d6b55a622d47fdf3e71baabe614c89a","d6d8a177714216b4e4398fad40e17b6503fc7c06fc4b669e5010c4d5b0fe0c14e179ac57824d509f50dc233a00a5752de816dfb2c1aebaaafd8700310c9c4f08"],

        shares:['4d941e9d6755581106df5189c54cffbc104709867f3c77078f3ac17c0880fc1e','cb00cad4e2c6d490d322ec0eb55ee7e381cd2e6a0e598eca12a1cf06a918791a','315dd8656357528f41e6140cf01b9f40cd01d1e2b4fafad40e706bc08aa45912'],

        id:'084fed08b978af4d7d196a7446a86b58009e636b611db16211b65a9aadff2905'

    },

    rootPub:'bedc88644f0deea4c0a77ba687712f494a1af7d8869f09768a0db42284f89d17b7b9225e0c87c2cb5511907dfd5eae3a53d789298721039e833770de29595880'

}


let postQuantumDilithium={

    pub: 'bfafb8ac70403cb603342a90b0f62673a2bbd2cd237148d47620794135abeeba56b72ce5d2e6df9b96d11b2335f23712735eaeeeaf25c1f1d5709dccff4387146e8c7ed52ae6982b0ca5a6e921c4f61e2c527e2d9da3d7a842372e34290aea51781a1f561f0daf49e6a0a1067524099a4741c7f64a25a55d02a2971b31ab27f6baae0c66f7bfc7619d03ff3771b029378c5e79b725b6ce9c39a0cf4c8708993c19b65fd3492a96076b01fa2f89c5bc49c142db67480460adcf9f628486e6cac6af8340bd96345bb9e8ef41905e5f5082428393ffa8ae978830ad3d96b5f705c45f0640d87fecee7a43e6c0c493833c72d24d2108dad6e20b2ad36a38f1790d835238138831fbb93dfd9f11f46cc2e7ebdccd3f76d0c160cdd743969ec5ce8ad26029f85325713e083f9fe8169f235ab2d719c7135b1ab8deec707f0caf1d118fbfe469f65d29fd88fb07a6d4d3adc861df4c8f2708ea0357ccf4b396cd1c0b41aed632527508c2396010de94134d90dc03a30a95e32336ab839c7b3976583891ccda980c9104c8de8dd784ba9c587a93083c4ae4f9d117e025e2cbb3c53b8828e11199f1fed89dca12e521df07eed3e28cab3fe1e1404c5891ee29e95854536cc065e1afd558e7da0adce618fd09953820df5bb959dfe317d5ad7b2882e33c637851956898438c10f3537d907a5f68e6c813f40b2e4ddd25f6d8fe57ac456cfd0477a327dff747ccf469356b0ba1365860b39ca038670a8f4255755c5b8d8925d70a3bca508c0d53c75a9d7863aea0fdc0964fae59c2ecf150620224e49096064bc56689b169f4dab85c964bac05036c6ba0006f300cbc72dd866574e76a35ec239bc94d4b7601baf13da3eb9457714748ab82e80ebfa163618c64926ac06fa6ca83d713ab7b1debd78d115244ad7924175e00d827675f248c5c54b247d425d3fa379fbb9c1b90b1d5e7242132cd3e672891e3eda74651585f4d5038bfe12a8a3b289f15ea42dfe480f1a76290b2e78e7f8668712e144af4eeb9906235285e669f4c85d268ec6dcb73310331dc2550b151b41df6b570d7124f90af0f6ad18b2e296afd30c08eb36e1fe2d58d8ad462482c598a0e17e55c4f101af212356d9cee2aa1fb8342fe26b060e93509e21d895f11f742d4707b74027348b2838a045c51c10dd0c8fe563fd813bb6f99ebaf20182431d927fd6738c8c9731086997b1b9cb2ed628bd931ca996db3572b6ce075e0e78bdfc066790110e5e8e538c11623ceaf66e14aa1757ce052f52b9c9bee54f765b74a48de44cad593d4973bf84f663b594d475fcfc638fef7414d546fb2fdd0785958499ea16fbc7df84646d05b769675f781538319447292f72304a163d1f7155d72fda67907b7af9bee6a0b323c65e4800603f72501027e339691c899b4154d519a3fcb5d33824e06e194fdbcb4e7a390151915b644e55416cfc129ed2a07e30a7adf1a363dfcc3e20731ec2ba18c6115324516de9bea5b1f3b0852aece124648340842b4658484da6f53d5edfb197d081cc96fdfcb350e4152b3eb17853cca40b6d584e81bf133b098962f876054a77faeacc662a935056893c06c876d92392457d4465372a3770911772eedb507e2d54645229c5aa1217dc1bb0a4a6f6e90e46a60d35e790e0283a31f754ede7be16619050abc7abc93ba06965d59c50d2f9e749a2151724369928dee17f4a2ff469a0c449c69c7e94cc1a9a0a74948b19672483cfeaea253bdbb032ff22edd80fe6024e087893f29f7fa3f03b346b7719f4946010d4eb7d42f0a6b37f616b3b54417e507f04e5fffc640eb31ff50a7d227462710c29181d116dcbae010a23b82f865b8e90f8f29096216dbb932ae9df1aa51befacfb730b08bb08907a660a06336ac2bba2026a4133ee471ebe369e2b2d29c2e7b7eae15c827b9b615107f13fd8fe7d74362e15cf9afaa7fa352eaff83db0dc68504c96a5b3999ad1fccd78018f4a6d50745f4c8835fb0adc93dc921953d2ec161f53664ae9a7e73e879469c42b52beb9c2a14ab5e3e12f64f9a80dac4844a887443b0b0d4c290462d0712e9a02d2f216f99f15235a23b4ca6d628e28d3d9c2af79686ae09ca110611577fee4a204c7bab4d23d1da5b29edbee9489b3f3c119e2dfe796b7a758aed1a9280f39b73a5d9b5888e52f4c5c2ed9434fb53940c1878ebaa369bc40a31c8227da7ede0cf3e2f619744bf1ede2adfe2d91256522b66fcd6ac194e13e2c0b069708e0df9b8a3e0b3b02614400b7ba69be77453b7be612ecb6adfde93b64ce01c07f28de175f71b657d53414a7cb1ccdabe770d4f7b3a1f6dee1548f7d8e6491d7054afc434837009c53ebf9762074900b7afeb2bfa172b4e2980aee6089c3e6b776b18fc63866b18f17be22aa8c705f70c4daf428bb408f14deadb5ee26f1e22c29fe6d0923336fab98e866399758d06dbda2558ce14bf2e9d5e5aa70b10096939c17471e8391fb9ff7f013c6fa68150dc6373b50439676a468a0b2effb6eb1c7c2c4a1df38fd6f1c9cee639f7d8fce7b838fa13c3905b366bc0f4d0b9a417d82e42405ea175319b565df822beb8915dada8500aab1436bf632500f2eb72e32fbc2026e89808cf2c91a5c1b98ad767a73d0b3a8d60d24283686d65f2563c5b40d35d1c305760c18715211f955e4ca04dfb35c2c9dbee08c62470ee2db89c06817992ef10eadaff468d21afcff0a480dde314f4976699b48841074e8b2cd259198a9c2a149cd984e0187e77bb3d5d3e229e2b4502f0d6433342c0325d3140a23f2e0c0ee8274ecb2bd35217722beb2fa529f549714a4e1a07170b326edf043958b5a63739395a988a693e25c25e74a64b44c00f750329c55e6647e0c5a2760914ff1cd7add97de4bddccffee21747f9d150baa3abc59de5804309a8d932652b793803b50db3c7811265b87a71e4d6ad9b54809d66b542aed1dacd0a3b1057f196ee7afefb8b59ec09fca0c7b7941dbed1b642b0ab96c0b8fe5b1aa62b63861f220c8b89bc9af95ed52fd0f683ead5b39495163188cca5298d51e91860021919ac2f7af737adb4a03592bd2bc590e1ad064f831a1841ea1f35836885d40192113cf55cbd589df21f5d1716e88eebb79494ca6a3ba908e0b1e098d31a0e30d87ce08d52145995a57ecb51c02d9ab0a516fcb2b288646dbad6eb32579635a841e3c111ed7cbeae065d58cba66c26f1191ca9ae90adc5d6496a41ddf4c22885923fa5a8d0e60c51fd6b2c6300daa0018a12d71351b7cb58f81c3e7bca4d729ab6bbe597b57e0772bac47c5b33235eb2cc4d33aeaabb5dad9cb247aba7aa90be1c3dbce42b7214e1cf99b11da92496213006d528f344e4af2156f385eaba211582a49292daf1721dc834f86dffe908b099c3b65259940daef5649955a3939ceb5de7f6199d0aff23dbe25af939a9d119ba12d16366abcc5c0c07aae531fec8153eff260a4bc81195aa9d7f7478558cd3f89ec23690acb0a5705b31e7ff899a98f129696ef923af9f31185dae1645cc3d680cdc8c3f4160b202089f1102e6c27e5ee949f17efeb5adae1f50c53527876b3e4dd03337aa3688d9fc60d288dde8e4d8c3c74c4fc11c572b07b2a00d1d26e0682fcf868a4ff96db5d1993a4ccab7646fe08ec69d0031',
    prv: 'bfafb8ac70403cb603342a90b0f62673a2bbd2cd237148d47620794135abeeba4968f5030f39cba05052505c6fbee0e4230519f2ad11f2edd7d95d2b53266bf673d735deba83fa286679bc5c8b98baf29e03826e8da7c1fbb2675f2f1b706e2e60360a13a36403034852b688a22406481012888011c9305201a44800028283c001100141c2800049404d58200212498d881060e0a83023c8218bc669e11809a186491212610b2032e3a850c9342c5aa284d1c68988428964444d90060964244022c75103b381e0b48062c82009063153a8240c41020a828500100e6426510aa86da1b86892c24409137220200dd89664e0460512c78c01b0488c206e009061148568d036904b228d0c95241c208d181669db400e11a52888062edb224621125280240ccba669513285a230692425281a27080a101202b74d13c14d8c304064402ac9b8241c17899a209224199252c4694836304c366d98384e23c9495c8405e4046698947104c30122b9304a8229d432901c944d08475052a46924b190da08080bc12504130e11b91018108002c510a4062e628621614600d2c4251a924022043002940d948868db023211c62d8036025406405a048248422ddb1412101782e03860990800c114728a4206c3a06dc4c41010c448d04620940682c1126e0436448c204842c671c930711b834d41a064d2924590a82ddb8601d9340009a96961064c1114606248602385201cc681d490250c452d0a407124c38c119030c1a85021252cd2262c013461a3904dc48225dca4500a256a1229921c2460090951592864148220c0b008243944da048204022e0a012e9bb068141186da340018150251966d1c89206046215b008c12173113b14dda16120a9089d3a010c1822593408c1205125112641b310aa2b871d9108d0033040a0432dac010123102e3042ed2860d834442d9b84cc1120688003263222890a249c2184ed9042da216688c0208e02631c28469c84491dbc491d12891d2448858828cd8485183420cd0048c222269482632823228233321901864209610dc9629d4c84c61283191b408490286d20249012345c2b60d212709d4a2401ba3651a44448bb22c1b04711c020c1a21244010510c418d08030890804551b031234846833804123862ca802c43824512094609214d0915421b866840026c02c788043050cba06080865140c46084308100892488b270d1448d1419901ba4691a048e2244855ab2290ca001ccb40d24c80c22a3488b864c524260d41090e1c829d08091c92628412471ccc201e3160aa2b860e2162cc12020a2c6602336651bc39154044e9434291bb04008b09192082d02a820849044c89401812204c9a40d99c22cc8b805da1068d03065c49251cc02049a200c9ab440e39644c208328ac824da0264419884e4461203b02c1b85251212454bc2904c12081a354e53a2210c314252c66008814c0ab060dc2660d800818b1826c0960c41404ad1486a6182909830420bb28011459143822119268c4a308109452c0b420919c965d2082203c730cc221188263183026803232911c26dccb86118394dd3148a044328a3228e88b26c01957110a92983084ea4a0495326265ba871c1926d89003018c328c9003289382e12196a81b88009496414964d40b80542422a239809514022904612021789239451208331a4b66c8246889a048453c0481b352488942541384593306649084024a660e1083083084a5a94441b2245808809c114305c462d01113193468689188a48b42581086143066920c7308236060846805c120a12b3490a00600999490090451cc0095832520c406250308ad8b81019164108392898b649d3328e0a82008c12721c0681022549423424c0042621b06d94c20410100e0239428b2289d2487102168d02370a64100ae0140c2002241028890491090c43481a224c24c69000c641601432c8049192844598387222880003a20c4496901a3310213200d400208b8008204521512090d9c03091204c0889118b44919848025ba821083260e410052311519b4482e1202d190589519609e19241012648e49045e2966498169211a64d13a2299b4250240461c2a68d82c210a4120903157003204e118169c0221214154409a2500827650c9611040085dcb8248d61b8cda53d8ec94c17f5700f28dda5d9ac7a759521c4cbf53d3201883c1dce095fb230926afdb3fd13f1c0317d8a3d1bae5b8d39ad2d123bbba4aea9618168ba9b42392ed57d1fad85fff388e26897e51c8cb2ceafc405a1e618f339b6ca11db667719c1c6ec811db902dafb94e5eed6644592f390f42f6d741fcdf9b8511432c260f51a7c900ada82f550732ad013606287e860b5d6413dacaf3d0916e9be2afafdbe9a8949d05fece51919bb8b6403d59af1f2435ea102f419d31c63a209d4dda92ecb73b288d855bdb89faaba1f33f7590dee25a2202f04117e721528013c6bb9424b8ed41a655c6e1926b283a7dcc2a3899935fc4cd4cb78bb7b7cb06d7cf21f1c8a86ea0c818ab86a0526ff4e43ddbabdb8507212c79506ad54d6afa195a0f35c391693852c64014b9aa6450805b75982fbfe2321a8eb80a7a415550ce92ee3e9c01496ed9f82cfcd54568e0cfa50280afa927081d36bf19a76b94d24c69ffd7a6e2865c41a3a69d3b76816f450d6d71865d1721076402cefa8c68987e2fba474cbec44a91d5fe375a4ff68a408566b919f315e09a00a678b614b938d82a692e7f26a81319837600091267a088cfc2aeb04563ec6ddf762508cda60893869a54b7a9058f00e68e814bfda071923d89e544474b81acd90a60c16e270104c4efe5e712556ed007b4b6e9ba5ffa8f967094d6b1263aeaa5f827a7c32b993d6d455bcd803b448455297d8dbc66f695df2df49d3fb61f9a1fd0dd8d40004a68143589d83d5757ecd431e96a09ba9a825444fb3eae0d3dc9a60bfbb36def16867a8d2534bf347605dfd3bb192ffa59471e7a58a93bf33ba57f424fefcd00def85c3e1b1323958f1bf1e70999d82bc6cb69ba0b0bb8b98e3c4ca7e49fa0f2c8faeea502f5ee28cff6821f223ab05a599ab5fdcc76f8007a516692e6f4e863a5ca919b9371cac9090959357959e7bac5b2d26d128fb1a21cb3db00e17382d31980967f7781d17f117a7daca7e2bbcfb0a3d4921daaaf43417b7a673e9cf78e1102624bbadd9b62e6e89b2cffe8e1ef746c939323bd23a5f24cf712fe01776d983fd4fa9f22eb773592f8b84ee8be3eb29a41a7a79d31fcdba3a0df399bde9d12760ba010e226937849a9f56469a5c3ed9159e6a1d4341ccf00b3c8dc50b42d8c4c696228d92a6cace380822be55e33fc6c538dc437355b986bc25f4e392a85f8ba8703d75481880ac6674497ed6f7906d046da49b39f7893252dd428e4a60f0104d31e66ef06e7087fcae3d476d71fdb4e28859697d88e980586cf27239da828c01023b4e9f9492f23a68e410fe3c6bafc5eadcac37ed53c1e261592c83630cb9096f3b2148218ec5f994e44afc455ae767318aa83d4f5d4d016753f40a458d00677e42ceda2b9d850feb76f4000cbd5b4543d02bee5999c10c2f042fb6e965d16ea22a7bb07f26ee5bc100cbb2831e7f9ae8c56ba428ebb31cb82c24106be3b3615ba263ed90fbba37b976a58e2a5eb65feb1bfcbf1c463c691c542bc228ea5fa1c1c168ca2ef3acb8fccf801d7551dbe9d00c254f67a0d261d1370aaa81daca2792edc6ff6ee8e64850e2e1f44f99dac0f993a28ecfafe19420e7dddebaedad9ec9bff1beb5f6c8851186d4f0f5232b27e239bc14f3e78b3d982aba60948516666ab4d4d553a3c635fb22635aefac31939b0e69d6231a4fcd767444ae52df00f78216714d4e284081fd66b008d543f23d8a9bb276d1136ea542c0892a1c52121892c2082149003f1ae646948f4e09134da0df87c6aa737a19cba43b2075ebf51e8cd49dae521c4c38a7955f46cb59d3debf9ab8cf3d11e56ebe9a43a2ba69957c57ab86e73deccf7541b5f79bf6f13e1028939353ebec170a8db99226e5364f9b16ba8b5669e2389fc2821049fd975525c84434b02c1252544c7217b828a35bb1c774ef6dc4694df8a965e07568ea43fe7799b278e153b1100ed69353255bfd9ff486966542ba0c6548cdc7eb4f092268024207485840f1b45fc8e6d8366f6affb5a9fd57d6e9ff57ba2e14557e69d7a48c9100e9f6b39e79f2f6ded230f02c09ebca43ffae04271a386aa8cf4f0aa74ea82d028efda3974478869ed59f620ae7f0ee8355a52b2544962991b26f4177968125d101e5eeb52d38cd2249659c9bf7886ee455dfb77b58b1bca3f54c6aff17b9de3901609fa2d33bfc634abc96411a8b1807b6d42d4b6313cecc8f2ca71696ebbfc8e03c6a658c71c250e6cf609de1ca12a20e3a503667b9ba4ec664df03fdf9f9e040d671167eeece6b9c455025114760e861c8e6d739a089309d3677c6d1448ec9cf5250dcd25e8a590597b29e131ce6167e627e629224f8ec8ec84ae7282c348a7b7c716ee364766ab885b65d8529a849112dedc580bb52a51cb1107f3b59e70b1d47c121b3c5f9b26f2e4d10a0450b7dce43f5ecb0be5b91cff412111195d8215bf21ea413c22d9f007f9988d89153e17210c35afd801d0e45af8f6f6c9117c66ced6f0758d128bf13b51a73d86675f80fd65d97cb129cfe7ce4c5c1c9c5f47fd99b3e4c001aedc3837d39d94dbfea5f350a2747ac5d0b0958d45425d9c5260f0ee26a59f2f4b3d498f287229819b87cf76aa4f763459dd8fea899d3dea36f0c89072a65d4f9b7aaf48a6c1d3035d6a46d27a581ab44413608ca56e4c22ba79e0acecf5d4b0ffd055880012b9d0cf21881dffb23246369e3776efa20b06ea7d76f16297714da06d49cbfd136b4f4bc742e5b1d4fbe78d54a63855a75eb353d6412542194f015f9a88cfb83b681207048e47789846e7dda1eff957162f969b3f1a348ec7c6ea9518759618f9ccd6a52e4acacc4c0ab921c21f1ba1ded108bc7462a24938d113d345743f746e253bb24512840c80c0117541ea0064cee4eb4836ca35fa82ce1a06f970f73626d4a0b9ca017e146e3f658d913d455d3f726741dc8e4ef78e820c79a5e0dba7350d9f238c3f232449e5b4563a75f9f23a7352f953ff40a3f530bb09244436df5bf147ff3be40356eb7b366b0d1d15fa04471da896bae32e0f14c0b92632918f56fd91fb65d3d2752cf9944370b0a5dd6f9060e0da4984ea7c6b9869a456d3d7b9293be6b2c58be858ea7498f4976dc5c3bf699e0b7df8dbf249f846cff0cedb6b13754707473f7932511ba84b7ddc795aba3010bb25e46ec2cecb97048cece0b0231f7e3bedf447a06a8104fd89bd78fb2323aa031b14ec161dd32ac1b0383a82016d50fdf50fafab5bc03370fc38cde7cf62b7a3bc928fe007869e6934383b87a2769b01657ca311fe7e9b0f7e2331ebe2bd0f71148830ce01af8c9d64edba289bee7c2c7041ebc7862ca05510d70753cb04e78e855cb0470f75cdeb8043dfa2df584a1e35ca0cf9a64dc866240754a20f7a5e7973436e1bb71bbcc1980f94193585c31a97be54402d18271314884c9d59a7354a87675fb20d9466493087ae75e9fc8ce781e9924f38baf85ced237345c5e4b7e4d0b6111f71d76b3d433e244642d681615856759dcc59fc7d5316150d0c89b46d9e7c5391eaa7e1944748a964680d84c217b62118808c680bfcdf8f824be1e14403df26cd486c16efe5a1589e2d401684619273134ae9a078fde634f2f199ef48f538464d3c187c9a2f304afaab767c997edc6dd29d5419770b50918c514ec07d81e42972006f613c92aad27e810dc686a09f0cedd9d01c399a03bbd0233a14baa9ba09c1afd9c20f8fe2ee383d4eae4c29cda584ef3406da3eedd35ce47ffbd911a466ac5c0760bf2912474214451d4c7364d6ff815321d03dcda4c1a0769bf226610a6821c459df9ebd02f0dbbe58495026d8ad41a4d6ddd63ca99d00f109b65bd0f6fe5e14e3dfdb1ec7dcd58be4dc26d1b9cb93c34bf5704ec566a804bb9cd0ee272df03277f4abe73915ce3d989c547e848d3a5476f7caaea120c62812a3fca6d17a96d82e87d27f201895f2e909ed3e3bc7ade19b1c7eb7532a4fa692e2fdd682f2c290f0b933e5982b652d3ec5ad52b43df8e4220c69977da7636cac5339e3377e4441ab61c8ebb17934a1f83ca0a2ef9c6be2bfc6fbdb277dac9580e8a2baad5406caf2dbea55042cd015b6df0f62ca26dd503bbc35b14df5b8f7c83131800370be8c361cbaa5b85c60c20e944f6564a4bca56bae600eb794f67f266d9059279aa168f24c5150eea6b16182b699506441959f37e0e8107c6bc7b9566e00c2c8456efc77a3f410113b0688cdcecb073023c9f08251a486a962cbb4803f765920e0c997598acb85f8b78d66b66b2bf78ff7cdee1294c0d81f459b0738b6ada2310e1c781353154db959ee8ad90ad0c87cba69ee8155c45036d9d2f5561f605d935b70629332c9437b12858cafabede9b6a2f55949177959ecd1d021c9b552074a467d3995d6b7f38e1028d008ed6d4bbc2300c0dc317b941b3093d5267f364de944dda55c9ec030035d977fd59f2678b581ab2a36e977095cf381520380e1940e09739ce8cca147021163c15467d0dc5d8321be33defe0dbf5f0e28bf694c4570e27e3d21a714a3affd484bd4f2670e222b37885d9d16fcf983885efb855cb73d28ab2b1011c3a507ebfb4d1b7139b06378a8a8fbc2c7083917e56de2aef7f2b34c88af92948fa54a3d46e2eb6ba895cbb3e1019fcba4a6cb066a870103a65105af8f8317ba61f1d5d42',
    address: 'f5091405e28455880fc4191cbda9f1e57f72399e732222d4639294b66d3a5076'

}


let postQuantumBliss={

    pub: '001b4609d500e31a0a188911900aac07fb06f91566038104e90c01031707d6154701701a15046d07f5089f0c730c8515e712c90b5a130d10081bca0ab40c8f0027101501870ccb17041d691bac0c30162d11ff0566198710f308cd08b30be804261a040c530cb8042e16841623069200b9175410a5016a171e1ceb10f813261bae0acc06be176214471d7013530d92180a0dbd15c800fd09f700ed0a8616141a14095b08a71c3317031d78106602ef1c1f1a53097016df192905b50ad40b5c1d1c027e026b0ecb115417ae1b6f1c1101c60d3f1c12016010a309f8183411840d7d12d414071a5b10d1162111f712951b36066209500e1d137d1dbf055417e6075c0ce307460ff9040715b51d0000cc11cf1bd1194c0a2d19e901191c5306040c8002be0d19024f10b31b19152912fe06900de21b2e10110ab111f80b6403ac1b8505221bac09830e3501a1175705c7138e1db6035c09871c4c121706b70b560ac70c001d2305b0107117ef02c1178a13f010bb193004ca02bc035e036f109419770a2017f11dd00cb3016405b41604091206c61603085208fa0df0130912cb14cd187914b009e306440a3018ca0c5810c305400507103b1113016c0ead00100e3f02b6003410981cdf04c50d0213d61984110c0ba700ae0c8912f618a01a231bc81066010a1d051242103013ac05c30dae14030f890e1117b319a002a707f30923',
    prv: 'd112525a9435c29d732592e9ec90eba2ae7b1ae2c0d3ac9b6d6ce662ca5140abb02bc846c7f54f955a84fed543107c9180366d025324aac2d253ec60515cf9ee',
    address: '1826d3782d53b127c53129fe67f4a3e3c1140feb2af36a0517077297a6e867e5'
  
}

// EVM account

let evmAccount0 = {

    address:'0x4741c39e6096c192Db6E1375Ff32526512069dF5',
    privateKey:Buffer.from('d86dd54fd92f7c638668b1847aa3928f213db09ccda19f1a5f2badeae50cb93e','hex')

}

let evmAccount1 = {

    address:'0xdA0DD318C511025C87217D776Ac2C98E5f655fdC',
    privateKey:Buffer.from('43818ec87b33c38d65fe835e3143010fe08bce8da962aab996dc239229a6b574','hex')
  
}



//___________________________________________ FUNCTIONS ___________________________________________


let GET_ACCOUNT_DATA=async account=>{

    return fetch(`http://localhost:7331/account/${account}`)

    .then(r=>r.json()).catch(_=>{
    
        console.log(_)

        console.log(`Can't get chain level data`)

    })

}


let BLAKE3=v=>hash(v).toString('hex')


let GET_EVENT_TEMPLATE=async(account,txType,sigType,nonce,payload)=>{


    let template = {

        v:WORKFLOW_VERSION,
        creator:account.pub,
        type:txType,
        nonce,
        fee:FEE,
        payload,
        sig:''
    
    }

    template.payload.type=sigType

    if(sigType===SIG_TYPES.DEFAULT){

        template.sig = await ED25519_SIGN_DATA(SYMBIOTE_ID+WORKFLOW_VERSION+txType+JSON.stringify(payload)+nonce+FEE,account.prv)

    }else if (sigType===SIG_TYPES.MULTISIG){
        
        template.sig = await bls.singleSig(SYMBIOTE_ID+WORKFLOW_VERSION+txType+JSON.stringify(payload)+nonce+FEE,account.prv)
    
    }

    return template

}




let SEND_EVENT=event=>{

    return fetch('http://localhost:7331/event',

        {
        
            method:'POST',
        
            body:JSON.stringify({symbiote:SYMBIOTE_ID,event})
    
        }

    ).then(r=>r.text()).catch(console.log)

}


//_____________________________ TESTS _____________________________


let MULTISIG_2_DEFAULT=async()=>{

    let accData = await GET_ACCOUNT_DATA(user0.pub)

    console.log(accData)

    let multisigPayload={

        // Required if the sender is a multisig
        active:user0.pub,
        afk:[],
        
        // Required fields for TX_TYPES.TX
        to:user1.pub,
        amount:1000
    }

    let event = await GET_EVENT_TEMPLATE(user0,TX_TYPES.TX,SIG_TYPES.MULTISIG,accData.nonce+1,multisigPayload)

    console.log(event)

    let status = await SEND_EVENT(event)

    console.log(status)


}



let DEFAULT_2_DEFAULT=async()=>{

    let accData = await GET_ACCOUNT_DATA(user1.pub)

    console.log(accData)

    let defaultPayload={

        to:user2.pub,
        amount:100
    
    }

    let event = await GET_EVENT_TEMPLATE(user1,TX_TYPES.TX,SIG_TYPES.DEFAULT,accData.nonce+1,defaultPayload)

    console.log(event)


    let status = await SEND_EVENT(event)

    console.log(status)

}




let MULTISIG_2_MULTISIG=async()=>{

    let accData = await GET_ACCOUNT_DATA(user0.pub)

    console.log(accData)

    let msig2MsigPayload={

        // Required if the sender is a multisig
        active:user0.pub,
        afk:[],

        type:'M',
        rev_t:0,
        to:'7bWUpRvRZPQ4QiPVCZ6iKLK9VaUzyzatdxdKbF6iCvgFA1CwfF6694G1K2wyLMT55u',
        amount:100000
    
    }

    let event = await GET_EVENT_TEMPLATE(user0,TX_TYPES.TX,SIG_TYPES.MULTISIG,accData.nonce+1,msig2MsigPayload)

    console.log(event)

    let status = await SEND_EVENT(event)

    console.log(status)

}


let MULTISIG_2_TBLS=async()=>{

    let accData = await GET_ACCOUNT_DATA(user0.pub)

    console.log(accData)

    let msig2TblsPayload={

        // Required if the sender is a multisig
        active:user0.pub,
        afk:[],
        
        to:tbls.deriveGroupPubTBLS([tblsAccounts.A.vv,tblsAccounts.B.vv,tblsAccounts.C.vv]),
        
        amount:1337
    
    }

    let event = await GET_EVENT_TEMPLATE(user0,TX_TYPES.TX,SIG_TYPES.MULTISIG,6,msig2TblsPayload)

    console.log(event)

    let status = await SEND_EVENT(event)

    console.log(status)

}


let TBLS_2_DEFAULT=async()=>{

    let rootPub = tbls.deriveGroupPubTBLS([tblsAccounts.A.vv,tblsAccounts.B.vv,tblsAccounts.C.vv])

    // let accData = await GET_ACCOUNT_DATA(rootPub)

    // console.log(accData)

    let tblsPayload={

        to:user2.pub,

        amount:17,

        type:SIG_TYPES.TBLS
    
    }

    let template = {

        v:WORKFLOW_VERSION,
        creator:rootPub,
        type:TX_TYPES.TX,
        nonce:3,
        fee:FEE,
        payload:tblsPayload,
        sig:''
    
    }

    let dataToSign = SYMBIOTE_ID+WORKFLOW_VERSION+template.type+JSON.stringify(tblsPayload)+template.nonce+FEE

    //_____________ GENERATE SIG_SHARES _____________

    let shareSigA = JSON.parse(tbls.signTBLS(tblsAccounts.A.id,[{secretKeyShare:tblsAccounts.A.shares[0]},{secretKeyShare:tblsAccounts.B.shares[0]},{secretKeyShare:tblsAccounts.C.shares[0]}],dataToSign))

    let shareSigB = JSON.parse(tbls.signTBLS(tblsAccounts.B.id,[{secretKeyShare:tblsAccounts.A.shares[1]},{secretKeyShare:tblsAccounts.B.shares[1]},{secretKeyShare:tblsAccounts.C.shares[1]}],dataToSign))

    let shareSigC = JSON.parse(tbls.signTBLS(tblsAccounts.C.id,[{secretKeyShare:tblsAccounts.A.shares[2]},{secretKeyShare:tblsAccounts.B.shares[2]},{secretKeyShare:tblsAccounts.C.shares[2]}],dataToSign))
 
    //____________ GENERATE MASTER SIG ______________

    let masterSig = tbls.buildSignature([shareSigA,shareSigB,shareSigC])

    template.sig=masterSig

    console.log(template)

    console.log('IS TBLS OK => ',tbls.verifyTBLS(template.creator,template.sig,dataToSign))

    let status = await SEND_EVENT(template)

    console.log(status)

}




let DEFAULT_2_POST_QUANTUM=async()=>{


    let accData = await GET_ACCOUNT_DATA(user1.pub)

    console.log(accData)

    let pqcPayload={

        to:postQuantumDilithium.address,
        
        amount:7
    
    }

    let event = await GET_EVENT_TEMPLATE(user1,TX_TYPES.TX,SIG_TYPES.DEFAULT,accData.nonce+1,pqcPayload)

    console.log(event)


    // let status = await SEND_EVENT(event)

    // console.log(status)

}




let DILITHIUM_2_MULTISIG=async()=>{


    let accData = await GET_ACCOUNT_DATA(postQuantumDilithium.pub)

    console.log(accData)

    let pqcPayload={

        to:user0.pub,
        
        amount:1
    
    }

    let event = await GET_EVENT_TEMPLATE(postQuantumDilithium,TX_TYPES.TX,SIG_TYPES.POST_QUANTUM_DIL,accData.nonce+1,pqcPayload)

    console.log(event)


    let status = await SEND_EVENT(event)

    console.log(status)

}



let EVM_DEFAULT_TX=async()=>{

    // Build a transaction
    let txObject = {

        chainId:web3.utils.toHex(7331),
        
        nonce:web3.utils.toHex(0),

        to:evmAccount1.address,
        
        value: web3.utils.toHex(web3.utils.toWei('1.337','ether')),
        
        gasLimit: web3.utils.toHex(42000),
        
        gasPrice: web3.utils.toHex(web3.utils.toWei('10','gwei')),
    
        //Set payload in hex
        data: `0x${Buffer.from('💡 KLYNTAR -> 4e34d2a0b21c54a10a40c8d99187f8dcecebff501f9a15e09230f18ff2ac4808').toString('hex')}`
    
    }


    let tx = Transaction.fromTxData(txObject,{common}).sign(evmAccount0.privateKey)

    
    let raw = '0x' + tx.serialize().toString('hex')

    console.log(Transaction)

    console.log('Transaction(HEX) ———> ',raw)

}



let EVM_CONTRACT_DEPLOY=async()=>{


    let accData = await GET_ACCOUNT_DATA(postQuantumDilithium.pub)

    console.log(accData)

    let pqcPayload={

        to:user0.pub,
        
        amount:1
    
    }

    let event = await GET_EVENT_TEMPLATE(postQuantumDilithium,TX_TYPES.TX,SIG_TYPES.POST_QUANTUM_DIL,accData.nonce+1,pqcPayload)

    console.log(event)


    let status = await SEND_EVENT(event)

    console.log(status)

}



let EVM_CONTRACT_CALL=async()=>{


    let accData = await GET_ACCOUNT_DATA(postQuantumDilithium.pub)

    console.log(accData)

    let pqcPayload={

        to:user0.pub,
        
        amount:1
    
    }

    let event = await GET_EVENT_TEMPLATE(postQuantumDilithium,TX_TYPES.TX,SIG_TYPES.POST_QUANTUM_DIL,accData.nonce+1,pqcPayload)

    console.log(event)


    let status = await SEND_EVENT(event)

    console.log(status)

}



//__________________________ SEND __________________________


// DEFAULT_2_DEFAULT()

// MULTISIG_2_MULTISIG()

// MULTISIG_2_TBLS()

// TBLS_2_DEFAULT()

// DILITHIUM_2_MULTISIG()

// EVM_DEFAULT_TX()


//__________________________ GET INFO __________________________

// console.log(await GET_ACCOUNT_DATA(user0.pub))

let acc0Stat = await GET_ACCOUNT_DATA('7GPupbq1vtKUgaqVeHiDbEJcxS7sSjwPnbht4eRaDBAEJv8ZKHNCSu2Am3CuWnHjta')

console.log(acc0Stat)



// let acc1Stat = await GET_ACCOUNT_DATA(user1.pub)
// let acc2Stat = await GET_ACCOUNT_DATA(user2.pub)
// // let acc3Stat = await GET_ACCOUNT_DATA(user3.pub)

// let tblsAccStat = await GET_ACCOUNT_DATA(tblsAccounts.rootPub)


// // console.log(acc0Stat)
// // console.log(acc1Stat)
// console.log(acc2Stat)
// // console.log(acc3Stat)

// console.log(tblsAccStat)